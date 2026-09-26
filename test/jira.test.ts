import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { jiraExec, jiraRaw } from "../src/jira.js";

// Fake `jira` on PATH is the node binary itself with this preload, so the same
// fixture runs on POSIX and Windows (spawn without a shell only finds .exe there).
// It reports the env it received after reading stdin to EOF, or (FAKE_JIRA_SLEEP)
// spawns a grandchild holding our stdio, records its pid and blocks. FAKE_JIRA_ORPHAN
// does the same but prints and exits at once, leaving the grandchild on the pipes.
const FAKE_PRELOAD = `
const fs = require("node:fs");
const hold = process.env.FAKE_JIRA_SLEEP || process.env.FAKE_JIRA_ORPHAN;
if (hold) {
  const env = { ...process.env, NODE_OPTIONS: "" };
  const g = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "inherit", env });
  fs.writeFileSync(hold, String(g.pid));
  if (process.env.FAKE_JIRA_ORPHAN) {
    fs.writeSync(1, "ORPHANED\\n");
    process.exit(3);
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
}
let input = "";
try { input = fs.readFileSync(0, "utf8"); } catch (e) { if (e.code !== "EOF") throw e; }
const keys = ["JIRA_PAGER", "PAGER", "TERM", "NO_COLOR", "JIRA_API_TOKEN"];
fs.writeSync(1, keys.map((k) => k + "=" + (process.env[k] ?? "")).join("\\n") + "\\nSTDIN=" + input + "\\n");
process.exit(0);
`;

const ENV_KEYS = [
  "PATH",
  "JIRA_PAGER",
  "PAGER",
  "JIRA_API_TOKEN",
  "JIRA_AXI_TIMEOUT_MS",
  "NODE_OPTIONS",
  "FAKE_JIRA_SLEEP",
  "FAKE_JIRA_ORPHAN",
];
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
let dir: string;

function parse(stdout: string): Record<string, string> {
  return Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1)];
      }),
  );
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("jira child process", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "jira-axi-fake-"));
    writeFileSync(join(dir, "fake.cjs"), FAKE_PRELOAD);
    if (process.platform === "win32") copyFileSync(process.execPath, join(dir, "jira.exe"));
    else symlinkSync(process.execPath, join(dir, "jira"));
  });

  // Retries cover Windows keeping jira.exe locked briefly after the process exits.
  afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10 }));

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  function useFake(): void {
    process.env["PATH"] = `${dir}${delimiter}${saved["PATH"] ?? ""}`;
    // NODE_OPTIONS splits on spaces and eats backslashes; quote and use forward slashes.
    process.env["NODE_OPTIONS"] = `--require "${join(dir, "fake.cjs").replace(/\\/g, "/")}"`;
  }

  it("reports JIRA_NOT_INSTALLED when jira is not on PATH", async () => {
    process.env["PATH"] = join(dir, "missing");
    await expect(jiraExec(["me"])).rejects.toMatchObject({ code: "JIRA_NOT_INSTALLED" });
  });

  it("pins the pager to cat when no pager is inherited", async () => {
    useFake();
    delete process.env["JIRA_PAGER"];
    delete process.env["PAGER"];
    const env = parse(await jiraExec(["me"]));
    expect(env["JIRA_PAGER"]).toBe("cat");
    expect(env["PAGER"]).toBe("cat");
    expect(env["TERM"]).toBe("dumb");
    expect(env["NO_COLOR"]).toBe("1");
  });

  it("overrides an inherited interactive pager and keeps auth env", async () => {
    useFake();
    process.env["JIRA_PAGER"] = "less -R";
    process.env["PAGER"] = "less";
    process.env["JIRA_API_TOKEN"] = "secret-token";
    const env = parse(await jiraExec(["me"]));
    expect(env["JIRA_PAGER"]).toBe("cat");
    expect(env["PAGER"]).toBe("cat");
    expect(env["JIRA_API_TOKEN"]).toBe("secret-token");
  });

  it("closes stdin so reads hit EOF instead of hanging", async () => {
    useFake();
    process.env["JIRA_AXI_TIMEOUT_MS"] = "5000";
    const env = parse(await jiraExec(["me"]));
    expect(env["STDIN"]).toBe("");
  });

  it("terminates a hung child and its descendants at the timeout", async () => {
    useFake();
    const pidFile = join(dir, "grandchild.pid");
    process.env["FAKE_JIRA_SLEEP"] = pidFile;
    process.env["JIRA_AXI_TIMEOUT_MS"] = "1000";
    await expect(jiraExec(["me"])).rejects.toMatchObject({ code: "TIMEOUT" });
    const pid = Number(readFileSync(pidFile, "utf8"));
    await vi.waitFor(() => expect(isAlive(pid)).toBe(false), { timeout: 3000 });
  });

  it("returns jira's result promptly when a descendant outlives it holding stdio", async () => {
    useFake();
    const pidFile = join(dir, "orphan.pid");
    process.env["FAKE_JIRA_ORPHAN"] = pidFile;
    process.env["JIRA_AXI_TIMEOUT_MS"] = "20000";
    const started = Date.now();
    const result = await jiraRaw(["me"]);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result).toMatchObject({ stdout: "ORPHANED\n", exitCode: 3 });
    const pid = Number(readFileSync(pidFile, "utf8"));
    // POSIX takes down the process group; Windows can't reach the orphan (README).
    if (process.platform === "win32") process.kill(pid);
    else await vi.waitFor(() => expect(isAlive(pid)).toBe(false), { timeout: 3000 });
  });
});
