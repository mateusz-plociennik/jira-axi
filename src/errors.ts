import { AxiError, exitCodeForError } from "axi-sdk-js";

export { AxiError, exitCodeForError };

interface ErrorPattern {
  pattern: RegExp;
  code: string;
  message: (match: RegExpMatchArray, stderr: string) => string;
  suggestions?: (match: RegExpMatchArray) => string[];
}

const patterns: ErrorPattern[] = [
  {
    pattern: /Missing configuration file/i,
    code: "AUTH_REQUIRED",
    message: () => "jira-cli is not configured — run `jira init` first",
    suggestions: () => [
      "Run `jira init` to configure the tool",
      "See https://github.com/ankitpokhrel/jira-cli#getting-started",
    ],
  },
  {
    pattern: /JIRA_API_TOKEN/i,
    code: "AUTH_REQUIRED",
    message: () => "Jira API token required — set JIRA_API_TOKEN env var",
    suggestions: () => [
      "Export JIRA_API_TOKEN=<your-token>",
      "Or run `jira init` to set up credentials",
    ],
  },
  {
    pattern: /401|unauthorized/i,
    code: "AUTH_REQUIRED",
    message: () => "Jira authentication failed — check your credentials",
    suggestions: () => [
      "Verify your JIRA_API_TOKEN is correct",
      "Run `jira init` to reconfigure",
    ],
  },
  {
    pattern: /403|forbidden/i,
    code: "FORBIDDEN",
    message: () => "Insufficient permissions for this action",
  },
  {
    pattern: /404|not found/i,
    code: "NOT_FOUND",
    message: (_m, stderr) => {
      const first = stderr.trim().split("\n")[0] ?? "";
      return first || "Resource not found";
    },
  },
  {
    pattern: /Params.*mandatory/i,
    code: "VALIDATION_ERROR",
    message: (_m, stderr) => stderr.trim().split("\n")[0] ?? "Missing required parameters",
  },
];

function firstErrorLine(stderr: string): string {
  return stderr.trim().split("\n")[0] ?? "";
}

export function mapJiraError(stderr: string, exitCode: number): AxiError {
  for (const { pattern, code, message, suggestions } of patterns) {
    const match = stderr.match(pattern);
    if (match) {
      return new AxiError(
        message(match, stderr),
        code,
        suggestions?.(match) ?? [],
      );
    }
  }

  return new AxiError(
    firstErrorLine(stderr) || `jira exited with code ${exitCode}`,
    "UNKNOWN",
  );
}

export function jiraNotInstalledError(): AxiError {
  return new AxiError(
    "jira CLI is not installed — see https://github.com/ankitpokhrel/jira-cli#installation",
    "UNKNOWN",
  );
}
