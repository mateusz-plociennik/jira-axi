import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { AxiError, jiraNotInstalledError, jiraTimeoutError, mapJiraError } from "./errors.js";

/** Context resolved from global flags, appended to every child `jira` invocation. */
export interface JiraContext {
  project?: string;
  config?: string;
  debug?: boolean;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_TIMEOUT_MS = 120_000;
// How long stdio may stay idle after jira exits before assuming a descendant
// inherited the pipes and settling without it.
const EXIT_GRACE_MS = 1_000;

function timeoutMs(): number {
  const raw = process.env["JIRA_AXI_TIMEOUT_MS"];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

/**
 * Environment for the child `jira` process.
 *
 * jira-cli decides between its TUI and plain output from the terminal, and
 * resolves a pager from JIRA_PAGER, then PAGER (defaulting to `less`) for
 * several views. All are pinned here, overriding any inherited value, so a
 * wrapped call can never drop an agent into an interactive pane or a pager it
 * cannot exit.
 */
function childEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TERM: "dumb",
    NO_COLOR: "1",
    JIRA_PAGER: "cat",
    PAGER: "cat",
  };
}

export function buildArgs(args: string[], ctx?: JiraContext): string[] {
  const out = [...args];
  if (ctx?.project) out.push("--project", ctx.project);
  if (ctx?.config) out.push("--config", ctx.config);
  if (ctx?.debug) out.push("--debug");
  return out;
}

function killTree(child: ChildProcess): void {
  // Kill the whole process group when possible so a pager or editor spawned by
  // jira-cli cannot keep our stdio pipes — and therefore the Node event loop —
  // alive after the timeout has already been reported.
  // Windows has no process groups; taskkill /T walks the child's process tree.
  try {
    if (typeof child.pid !== "number") {
      child.kill("SIGKILL");
    } else if (process.platform === "win32") {
      // Once jira has exited its PID may be reused, so never taskkill it then.
      if (child.exitCode === null && child.signalCode === null) {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      }
      child.kill("SIGKILL"); // in case taskkill is unavailable
    } else {
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    child.kill("SIGKILL");
  }
  child.stdin?.destroy();
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}

function run(args: string[], input?: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("jira", args, {
      env: childEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      // A new process group on POSIX so a timeout can take down `jira` and
      // anything it spawned (a pager, an editor) instead of leaking it.
      detached: process.platform !== "win32",
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let overflowed = false;
    let exitGrace: NodeJS.Timeout | undefined;
    let exited = false;
    let exitCode: number | null = null;

    // Restarted on every chunk after exit, so slow-but-live output is never cut;
    // the overall timeout stays the hard cap.
    const armExitGrace = (): void => {
      clearTimeout(exitGrace);
      exitGrace = setTimeout(() => {
        killTree(child);
        finish(exitCode);
      }, EXIT_GRACE_MS);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimeout(exitGrace);
      killTree(child);
      reject(jiraTimeoutError(Math.round(timeoutMs() / 1000)));
    }, timeoutMs());

    const collect = (chunk: string, target: "out" | "err"): void => {
      if (exited && !settled) armExitGrace();
      if (target === "out") {
        if (stdout.length + chunk.length > MAX_BUFFER_BYTES) {
          overflowed = true;
          return;
        }
        stdout += chunk;
      } else {
        if (stderr.length + chunk.length > MAX_BUFFER_BYTES) return;
        stderr += chunk;
      }
    };

    child.stdout?.setEncoding("utf-8");
    child.stderr?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => collect(chunk, "out"));
    child.stderr?.on("data", (chunk: string) => collect(chunk, "err"));

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error.code === "ENOENT") {
        reject(jiraNotInstalledError());
        return;
      }
      reject(new AxiError(error.message, "UNKNOWN"));
    });

    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(exitGrace);
      if (overflowed) {
        reject(
          new AxiError(
            "jira produced more output than jira-axi can buffer — narrow the query with --limit or --jql",
            "OUTPUT_TOO_LARGE",
          ),
        );
        return;
      }
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    };

    child.on("close", finish);

    // `close` waits for every holder of the stdio pipes. If jira exited but a
    // pager/editor it spawned still holds them, stop waiting once they go idle:
    // take down what we can and return jira's own result. On Windows the orphan
    // itself can't be reached once jira's PID is gone (see README).
    child.on("exit", (code) => {
      if (settled) return;
      exited = true;
      exitCode = code;
      armExitGrace();
    });

    // jira-cli treats a non-terminal stdin as "no interaction possible", so
    // closing stdin immediately is what keeps prompts and $EDITOR from ever
    // opening. Never leave it open.
    // A child that exits before reading all input raises EPIPE here; its exit
    // code is still reported via "close", so the stream error is ignored.
    child.stdin?.on("error", () => {});
    child.stdin?.end(input ?? "");
  });
}

async function exec(args: string[], ctx?: JiraContext, input?: string): Promise<string> {
  const result = await run(buildArgs(args, ctx), input);
  if (result.exitCode !== 0) {
    throw mapJiraError(result.stderr || result.stdout, result.exitCode, args);
  }
  return result.stdout;
}

/** Execute jira and return raw stdout, throwing a structured error on failure. */
export async function jiraExec(args: string[], ctx?: JiraContext): Promise<string> {
  return exec(args, ctx);
}

/** Execute jira with `input` on the child's stdin (used for `--template -` bodies). */
export async function jiraExecWithStdin(
  args: string[],
  input: string,
  ctx?: JiraContext,
): Promise<string> {
  return exec(args, ctx, input);
}

/** Execute jira and parse its `--raw` JSON output. */
export async function jiraJson<T = unknown>(args: string[], ctx?: JiraContext): Promise<T> {
  const stdout = await exec(args, ctx);
  const start = stdout.search(/[[{]/);
  if (start === -1) {
    throw new AxiError(
      `Expected JSON from jira, got: ${stdout.slice(0, 200)}`,
      "UNKNOWN",
    );
  }
  try {
    return JSON.parse(stdout.slice(start)) as T;
  } catch {
    throw new AxiError(
      `Could not parse jira JSON output: ${stdout.slice(0, 200)}`,
      "UNKNOWN",
    );
  }
}

/** Execute jira without throwing on a non-zero exit. */
export async function jiraRaw(args: string[], ctx?: JiraContext): Promise<ExecResult> {
  return run(buildArgs(args, ctx));
}
