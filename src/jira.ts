import { spawn } from "node:child_process";
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

function timeoutMs(): number {
  const raw = process.env["JIRA_AXI_TIMEOUT_MS"];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

/**
 * Environment for the child `jira` process.
 *
 * jira-cli decides between its TUI and plain output from the terminal, and
 * resolves a pager (defaulting to `less`, which may not exist) for several
 * views. Both are pinned here so a wrapped call can never drop an agent into an
 * interactive pane or a pager it cannot exit.
 */
function childEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TERM: "dumb",
    NO_COLOR: "1",
    JIRA_PAGER: process.env["JIRA_PAGER"] ?? "cat",
  };
}

export function buildArgs(args: string[], ctx?: JiraContext): string[] {
  const out = [...args];
  if (ctx?.project) out.push("--project", ctx.project);
  if (ctx?.config) out.push("--config", ctx.config);
  if (ctx?.debug) out.push("--debug");
  return out;
}

function run(args: string[], input?: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("jira", args, {
      env: childEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let overflowed = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(jiraTimeoutError(Math.round(timeoutMs() / 1000)));
    }, timeoutMs());

    const collect = (chunk: string, target: "out" | "err"): void => {
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

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
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
    });

    // jira-cli treats a non-terminal stdin as "no interaction possible", so
    // closing stdin immediately is what keeps prompts and $EDITOR from ever
    // opening. Never leave it open.
    child.stdin?.end(input ?? "");
  });
}

async function exec(args: string[], ctx?: JiraContext, input?: string): Promise<string> {
  const result = await run(buildArgs(args, ctx), input);
  if (result.exitCode !== 0) {
    throw mapJiraError(result.stderr || result.stdout, result.exitCode);
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
