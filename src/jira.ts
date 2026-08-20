import { execFile } from "node:child_process";
import { mapJiraError, jiraNotInstalledError } from "./errors.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB

function toExecResult(
  resolve: (result: ExecResult) => void,
): (error: Error | null, stdout: string, stderr: string) => void {
  return (error, stdout, stderr) => {
    if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      resolve({ stdout: "", stderr: "ENOENT", exitCode: 127 });
      return;
    }
    const exitCode = error
      ? ((error as Error & { code?: string | number }).code ?? 1)
      : 0;
    resolve({
      stdout: stdout ?? "",
      stderr: stderr ?? "",
      exitCode: typeof exitCode === "number" ? exitCode : 1,
    });
  };
}

function run(args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      "jira",
      args,
      { maxBuffer: MAX_BUFFER_BYTES },
      toExecResult(resolve),
    );
  });
}

/** Execute jira and return raw stdout, throwing on non-zero exit. */
export async function jiraExec(args: string[]): Promise<string> {
  const result = await run(args);
  if (result.stderr === "ENOENT") throw jiraNotInstalledError();
  if (result.exitCode !== 0) throw mapJiraError(result.stderr, result.exitCode);
  return result.stdout;
}

/** Execute jira, returning stdout + stderr without throwing on non-zero exit. */
export async function jiraRaw(args: string[]): Promise<ExecResult> {
  const result = await run(args);
  if (result.stderr === "ENOENT") throw jiraNotInstalledError();
  return result;
}
