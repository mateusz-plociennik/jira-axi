import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { jiraExec, jiraExecWithStdin, jiraJson, jiraRaw } from "../src/jira.js";

// Fake `jira` on PATH is the node binary itself with this preload, so the same
// fixture runs on POSIX and Windows (spawn without a shell only finds .exe there).
// Driven by its first argument; by default it reports the env it received and
// stdin read to EOF. hang/orphan/drip leave a grandchild on our stdio pipes.
const FAKE_PRELOAD = `
const fs = require("node:fs");
const path = require("node:path");
// NODE_OPTIONS reaches every node child; only act when launched as jira.
if (/^jira(\\.exe)?$/i.test(path.basename(process.argv0))) {
  const cmd = path.basename(process.argv[1] || "");
  const rest = process.argv.slice(2);
  const out = (s) => fs.writeSync(1, s);
  const err = (s) => fs.writeSync(2, s);
  const readStdin = () => {
    try { return fs.readFileSync(0, "utf8"); } catch (e) { if (e.code === "EOF") return ""; throw e; }
  };
  const block = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const grandchild = (fn) => {
    const env = { ...process.env, NODE_OPTIONS: "" };
    const opts = { stdio: "inherit", env };
    return require("node:child_process").spawn(process.execPath, ["-e", "(" + fn + ")()", rest[0]], opts);
  };
  const idle = () => setTimeout(() => {}, 30000);
  switch (cmd) {
    case "args": out([cmd, ...rest].join("\\n") + "\\n"); process.exit(0);
    case "stdin": out(readStdin()); process.exit(0);
    case "print": out(rest[0]); process.exit(0);
    case "fail": err(rest[0] + "\\n"); process.exit(Number(rest[1]));
    case "flood": { const mb = Buffer.alloc(1e6, 97); for (let i = 0; i < 11; i++) out(mb); process.exit(0); }
    case "exit": process.exit(0);
    case "release": err("jira: Received unexpected response '404 '.\\n"); process.exit(1);
    case "hang": fs.writeFileSync(rest[0], String(grandchild(idle).pid)); block(30000); process.exit(0);
    case "orphan": fs.writeFileSync(rest[0], String(grandchild(idle).pid)); out("ORPHANED\\n"); process.exit(3);
    case "drip": {
      // Output keeps arriving after jira exits, in gaps shorter than the exit grace.
      grandchild(() => {
        const fs = require("fs");
        let i = 0;
        const tick = () => {
          fs.writeSync(1, i + "\\n");
          if (i === 0) fs.writeFileSync(process.argv[1], "");
          if (++i < 5) setTimeout(tick, 400);
        };
        tick();
      });
      while (!fs.existsSync(rest[0])) block(20);
      process.exit(0);
    }
  }
  const input = readStdin();
  const keys = ["JIRA_PAGER", "PAGER", "TERM", "NO_COLOR", "JIRA_API_TOKEN"];
  out(keys.map((k) => k + "=" + (process.env[k] ?? "")).join("\\n") + "\\nSTDIN=" + input + "\\n");
  process.exit(0);
}
`;

const ENV_KEYS = [
  "PATH",
  "JIRA_PAGER",
  "PAGER",
  "JIRA_API_TOKEN",
  "JIRA_AXI_TIMEOUT_MS",
  "NODE_OPTIONS",
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

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform === "win32") return true;
  // A killed-but-unreaped zombie still answers kill(pid, 0); treat state Z as dead.
  const stat = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf-8" }).stdout.trim();
  return stat !== "" && !stat.startsWith("Z");
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
    process.env["JIRA_AXI_TIMEOUT_MS"] = "1000";
    await expect(jiraExec(["hang", pidFile])).rejects.toMatchObject({ code: "TIMEOUT" });
    const pid = Number(readFileSync(pidFile, "utf8"));
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 3000 });
  });

  it("returns jira's result promptly when a descendant outlives it holding stdio", async () => {
    useFake();
    const pidFile = join(dir, "orphan.pid");
    process.env["JIRA_AXI_TIMEOUT_MS"] = "20000";
    const started = Date.now();
    const result = await jiraRaw(["orphan", pidFile]);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result).toMatchObject({ stdout: "ORPHANED\n", exitCode: 3 });
    const pid = Number(readFileSync(pidFile, "utf8"));
    // POSIX takes down the process group; Windows can't reach the orphan (README),
    // so just clean it up if it's still around.
    if (process.platform === "win32") {
      try {
        process.kill(pid);
      } catch {}
    } else await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 3000 });
  });

  it("keeps output that is still trickling in after jira exits", async () => {
    useFake();
    process.env["JIRA_AXI_TIMEOUT_MS"] = "20000";
    const result = await jiraRaw(["drip", join(dir, "drip.marker")]);
    expect(result).toEqual({ stdout: "0\n1\n2\n3\n4\n", stderr: "", exitCode: 0 });
  });

  it("forwards argv verbatim plus project/config/debug context", async () => {
    useFake();
    const out = await jiraExec(["args", "a b", "--x=1"], {
      project: "PROJ",
      config: "/tmp/c.yml",
      debug: true,
    });
    expect(out.trimEnd().split("\n")).toEqual([
      "args", "a b", "--x=1", "--project", "PROJ", "--config", "/tmp/c.yml", "--debug",
    ]);
  });

  it("delivers jiraExecWithStdin input and then EOF", async () => {
    useFake();
    expect(await jiraExecWithStdin(["stdin"], "line 1\nline 2\n")).toBe("line 1\nline 2\n");
  });

  it("survives the child exiting before consuming large stdin", async () => {
    useFake();
    await expect(jiraExecWithStdin(["exit"], "x".repeat(8 * 1024 * 1024))).resolves.toBe("");
  });

  it("maps non-zero exits onto structured errors", async () => {
    useFake();
    await expect(jiraExec(["fail", "Error: unexpected response '404 Not Found'", "1"]))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(jiraExec(["fail", "Error: something odd", "3"]))
      .rejects.toMatchObject({ code: "UNKNOWN", message: "something odd" });
  });

  it("jiraRaw returns non-zero exits without throwing", async () => {
    useFake();
    expect(await jiraRaw(["fail", "boom", "2"])).toEqual({ stdout: "", stderr: "boom\n", exitCode: 2 });
  });

  it("parses JSON after leading noise and rejects malformed JSON", async () => {
    useFake();
    expect(await jiraJson(["print", 'note\n{"key":"P-1"}'])).toEqual({ key: "P-1" });
    await expect(jiraJson(["print", '{"key":'])).rejects.toMatchObject({
      code: "UNKNOWN",
      message: expect.stringContaining("Could not parse"),
    });
    await expect(jiraJson(["print", "no json"])).rejects.toMatchObject({
      message: expect.stringContaining("Expected JSON"),
    });
  });

  it("fails with OUTPUT_TOO_LARGE past the output bound", async () => {
    useFake();
    await expect(jiraExec(["flood"])).rejects.toMatchObject({ code: "OUTPUT_TOO_LARGE" });
  });

  it("terminates a hung child at the timeout", async () => {
    useFake();
    process.env["JIRA_AXI_TIMEOUT_MS"] = "200";
    await expect(jiraExec(["hang", join(dir, "pid-inline")])).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });

  it("passes the jira argv to error mapping for command-aware hints", async () => {
    useFake();
    await expect(jiraExec(["release", "list"])).rejects.toMatchObject({
      code: "NOT_FOUND",
      suggestions: [
        "Releases may be unavailable for this project or Jira deployment",
        "Run `jira-axi project list` to check the project key",
      ],
    });
  });

  it("after TIMEOUT kills descendants and leaves no handles keeping Node alive", () => {
    // A fresh Node process must exit on its own; a leaked grandchild holding
    // stdout would keep it alive until spawnSync's own timeout kills it.
    useFake();
    const pidFile = join(dir, "pid");
    const jiraUrl = pathToFileURL(fileURLToPath(new URL("../src/jira.ts", import.meta.url))).href;
    const script = `import(${JSON.stringify(jiraUrl)}).then((m) => m.jiraExec(["hang", ${JSON.stringify(pidFile)}])).catch((e) => console.log(e.code));`;
    const result = spawnSync(process.execPath, ["--import", "tsx", "-e", script], {
      env: { ...process.env, JIRA_AXI_TIMEOUT_MS: "1500" },
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(result.signal).toBeNull();
    expect(result.stdout.trim()).toBe("TIMEOUT");
    const grandchild = Number(readFileSync(pidFile, "utf-8"));
    const deadline = Date.now() + 2000;
    while (alive(grandchild) && Date.now() < deadline);
    expect(alive(grandchild)).toBe(false);
  }, 15_000);
});
