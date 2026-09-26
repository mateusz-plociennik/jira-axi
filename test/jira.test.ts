import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { jiraExec } from "../src/jira.js";

// Fake `jira` on PATH: reports the env it received, reads stdin to EOF, sleeps, or 404s on `release`.
const FAKE_JIRA = `#!/bin/sh
if [ "$1" = "sleep" ]; then exec sleep 5; fi
if [ "$1" = "release" ]; then echo "jira: Received unexpected response '404 '." >&2; exit 1; fi
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

describe.skipIf(process.platform === "win32")("jira child process", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "jira-axi-fake-"));
    writeFileSync(join(dir, "jira"), FAKE_JIRA);
    chmodSync(join(dir, "jira"), 0o755);
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

  it("terminates a hung child at the timeout", async () => {
    useFake();
    process.env["JIRA_AXI_TIMEOUT_MS"] = "200";
    await expect(jiraExec(["sleep"])).rejects.toMatchObject({ code: "TIMEOUT" });
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
});
