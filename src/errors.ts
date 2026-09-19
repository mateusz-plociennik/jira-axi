import { AxiError, exitCodeForError } from "axi-sdk-js";

export { AxiError, exitCodeForError };

/** Strip ANSI escape sequences and jira-cli status glyphs from CLI output. */
export function cleanOutput(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/\u001B\[[0-9;]*[A-Za-z]/g, "")
    .replace(/[\u2713\u2717\u2718]/g, "")
    .replace(/\r/g, "")
    .trim();
}

interface ErrorPattern {
  pattern: RegExp;
  code: string;
  message: (match: RegExpMatchArray, stderr: string) => string;
  suggestions?: (match: RegExpMatchArray, stderr: string) => string[];
}

/** Pull the list jira-cli prints after "Available states for issue X: 'A', 'B'". */
function quotedList(stderr: string): string[] {
  const values: string[] = [];
  const re = /'([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stderr)) !== null) {
    values.push(match[1]);
  }
  return values;
}

const patterns: ErrorPattern[] = [
  {
    pattern: /Missing configuration file|Run 'jira init'/i,
    code: "CONFIG_MISSING",
    message: () => "jira-cli is not configured for this machine",
    suggestions: () => [
      "Ask the user to run `jira init` — the setup wizard is interactive and cannot be automated",
      "Set JIRA_API_TOKEN in the environment once the config exists",
    ],
  },
  {
    pattern: /needs a Jira API token|JIRA_API_TOKEN/i,
    code: "AUTH_REQUIRED",
    message: () => "Jira API token missing — set JIRA_API_TOKEN in the environment",
    suggestions: () => [
      "Ask the user to export JIRA_API_TOKEN (Atlassian API token or PAT)",
      "Verify with `jira-axi me`",
    ],
  },
  {
    pattern: /unexpected response '401[^']*'|"?status-code"?:\s*401|HTTP 401/i,
    code: "AUTH_REQUIRED",
    message: () => "Jira rejected the credentials (401)",
    suggestions: () => [
      "Ask the user to refresh JIRA_API_TOKEN, then retry",
      "Check the configured login/server with `jira-axi me`",
    ],
  },
  {
    pattern: /unexpected response '403[^']*'|"?status-code"?:\s*403|HTTP 403/i,
    code: "FORBIDDEN",
    message: () => "Insufficient Jira permissions for this action (403)",
  },
  {
    pattern: /unexpected response '404[^']*'|HTTP 404|Issue does not exist|does not exist or you do not have permission/i,
    code: "NOT_FOUND",
    message: () => "Issue, project, or resource not found (404)",
    suggestions: () => [
      "Check the issue key — it is case sensitive, e.g. `PROJ-42`",
      "Run `jira-axi issue list` to see reachable issues",
    ],
  },
  {
    pattern: /unexpected response '429[^']*'|HTTP 429/i,
    code: "RATE_LIMITED",
    message: () => "Jira rate limit hit — wait and retry",
    suggestions: () => ["Wait ~60s before retrying"],
  },
  {
    pattern: /invalid transition state "([^"]*)"/i,
    code: "VALIDATION_ERROR",
    message: (m) => `"${m[1]}" is not a valid transition for this issue`,
    suggestions: (_m, stderr) => {
      const states = quotedList(stderr);
      return states.length > 0
        ? [`Available states: ${states.join(", ")}`]
        : ["Run `jira-axi issue view <KEY>` to inspect the current status"];
    },
  },
  {
    pattern: /invalid issue link type "([^"]*)"/i,
    code: "VALIDATION_ERROR",
    message: (m) => `"${m[1]}" is not a valid issue link type`,
    suggestions: (_m, stderr) => {
      const types = quotedList(stderr);
      return types.length > 0 ? [`Available link types: ${types.join(", ")}`] : [];
    },
  },
  {
    pattern: /is mandatory when using a non-interactive mode/i,
    code: "VALIDATION_ERROR",
    message: () => "Missing required fields — `--summary` and `--type` are mandatory",
    suggestions: () => [
      'Run `jira-axi issue create --type Bug --summary "..."`',
    ],
  },
  {
    pattern: /unexpected response '400[^']*'|HTTP 400/i,
    code: "VALIDATION_ERROR",
    message: (_m, stderr) => {
      const messages = stderr.match(/"errorMessages"\s*:\s*\[\s*"([^"]+)"/);
      if (messages) return messages[1];
      const field = stderr.match(/"errors"\s*:\s*\{\s*"([^"]+)"\s*:\s*"([^"]+)"/);
      if (field) return `${field[1]}: ${field[2]}`;
      return "Jira rejected the request (400)";
    },
    suggestions: () => [
      "Check field names and JQL syntax; custom fields must be configured in jira-cli",
    ],
  },
  {
    pattern: /Received empty response/i,
    code: "UNKNOWN",
    message: () => "Jira returned an empty response — retry the command",
  },
];

function firstMeaningfulLine(text: string): string {
  const lines = cleanOutput(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^Please (check|try)/i.test(line));
  const preferred = lines.find((line) => /^Error:/i.test(line));
  return (preferred ?? lines[0] ?? "").replace(/^Error:\s*/i, "");
}

/** Map jira-cli stderr onto a structured AxiError. */
export function mapJiraError(stderr: string, exitCode: number): AxiError {
  const cleaned = cleanOutput(stderr);
  for (const { pattern, code, message, suggestions } of patterns) {
    const match = cleaned.match(pattern);
    if (match) {
      return new AxiError(
        message(match, cleaned),
        code,
        suggestions?.(match, cleaned) ?? [],
      );
    }
  }
  return new AxiError(
    firstMeaningfulLine(cleaned) || `jira exited with code ${exitCode}`,
    "UNKNOWN",
  );
}

export function jiraNotInstalledError(): AxiError {
  return new AxiError(
    "jira CLI is not installed — see https://github.com/ankitpokhrel/jira-cli#installation",
    "JIRA_NOT_INSTALLED",
    [
      "Ask the user to install jira-cli (`brew install ankitpokhrel/jira-cli/jira-cli`)",
      "Then configure it once with `jira init`",
    ],
  );
}

export function jiraTimeoutError(seconds: number): AxiError {
  return new AxiError(
    `jira did not respond within ${seconds}s and was terminated`,
    "TIMEOUT",
    [
      "The underlying command may have been waiting for interactive input",
      "Raise the limit with JIRA_AXI_TIMEOUT_MS if the request is simply slow",
    ],
  );
}
