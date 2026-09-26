import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { jiraExec, jiraExecWithStdin, jiraJson, jiraRaw } from "../src/jira.js";

// Fake `jira` on PATH, driven by its first argument. Default: report the env
// it received and stdin read to EOF.
const FAKE_JIRA = `#!/bin/sh
case "$1" in
  args) for a in "$@"; do printf '%s\\n' "$a"; done; exit 0 ;;
  stdin) cat; exit 0 ;;
  print) printf '%s' "$2"; exit 0 ;;
  fail) printf '%s\\n' "$2" >&2; exit "$3" ;;
  flood) head -c 11000000 /dev/zero | tr '\\0' a; exit 0 ;;
  exit) exit 0 ;;
  hang) sleep 30 & echo $! > "$2"; exec sleep 30 ;;
esac
input=$(cat)
printf 'JIRA_PAGER=%s\\nPAGER=%s\\nTERM=%s\\nNO_COLOR=%s\\nJIRA_API_TOKEN=%s\\nSTDIN=%s\\n' \\
  "$JIRA_PAGER" "$PAGER" "$TERM" "$NO_COLOR" "$JIRA_API_TOKEN" "$input"
`;

const ENV_KEYS = ["PATH", "JIRA_PAGER", "PAGER", "JIRA_API_TOKEN", "JIRA_AXI_TIMEOUT_MS"];
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
    return true;
  } catch {
    return false;
  }
}

// POSIX only: the fake is a /bin/sh script and timeout cleanup relies on
// process groups (detached spawn + kill(-pid)). Windows is skipped.
describe.skipIf(process.platform === "win32")("jira child process", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "jira-axi-fake-"));
    writeFileSync(join(dir, "jira"), FAKE_JIRA);
    chmodSync(join(dir, "jira"), 0o755);
    mkdirSync(join(dir, "empty"));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  function useFake(): void {
    process.env["PATH"] = `${dir}${delimiter}${saved["PATH"] ?? ""}`;
  }

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

  it("reports JIRA_NOT_INSTALLED when jira is not on PATH", async () => {
    process.env["PATH"] = join(dir, "empty");
    await expect(jiraExec(["me"])).rejects.toMatchObject({ code: "JIRA_NOT_INSTALLED" });
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

  it("after TIMEOUT kills descendants and leaves no handles keeping Node alive", () => {
    // A fresh Node process must exit on its own; a leaked grandchild holding
    // stdout would keep it alive until spawnSync's own timeout kills it.
    const pidFile = join(dir, "pid");
    const jiraUrl = pathToFileURL(fileURLToPath(new URL("../src/jira.ts", import.meta.url))).href;
    const script = `import(${JSON.stringify(jiraUrl)}).then((m) => m.jiraExec(["hang", ${JSON.stringify(pidFile)}])).catch((e) => console.log(e.code));`;
    const result = spawnSync(process.execPath, ["--import", "tsx", "-e", script], {
      env: { ...process.env, PATH: `${dir}${delimiter}${saved["PATH"] ?? ""}`, JIRA_AXI_TIMEOUT_MS: "300" },
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
