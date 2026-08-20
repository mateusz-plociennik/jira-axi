import { jiraExec } from "../jira.js";
import { AxiError } from "../errors.js";

/** Subcommands that need --no-input to suppress interactive prompts. */
const MUTATING_SUBS = new Set([
  "create",
  "edit",
  "assign",
  "move",
  "clone",
  "delete",
  "comment",
  "link",
  "unlink",
  "watch",
  "unwatch",
  "vote",
  "unvote",
]);

/** Subcommands that render a TUI by default — need --plain to get text output. */
const TUI_SUBS = new Set(["list", "view"]);

export const ISSUE_HELP = `usage: jira-axi issue <subcommand> [flags]
subcommands[15]:
  list, view, create, edit, assign, move, clone, delete, comment, link, unlink, watch, unwatch, vote, unvote
notes:
  --plain is injected automatically for list/view subcommands
  --no-input is injected automatically for mutating subcommands
flags{list}:
  -t/--type, -s/--status (repeatable), -y/--priority, -a/--assignee, -r/--reporter,
  -l/--label (repeatable), -P/--parent, -q/--jql, --created, --updated,
  --paginate <from:limit>, --columns <col,col>, --no-headers, --no-truncate,
  --raw (JSON output)
flags{view}:
  --raw (JSON output), --comments <n>
flags{create}:
  -t/--type (required), -s/--summary (required), -b/--body, -y/--priority,
  -a/--assignee, -l/--label (repeatable), -C/--component (repeatable),
  --custom <key=value> (repeatable), --no-input (injected automatically), --raw
flags{assign}:
  <issue-key> -a/--assignee or -x (unassign)
flags{move}:
  <issue-key> <status>
flags{comment}:
  <issue-key> -b/--body, --no-input (injected automatically)
flags{clone}:
  <issue-key>
flags{delete}:
  <issue-key>
examples:
  jira-axi issue list
  jira-axi issue list -t Bug -s "In Progress"
  jira-axi issue list -q "project = PRJ AND status = Open"
  jira-axi issue list --raw
  jira-axi issue view PRJ-123
  jira-axi issue create -t Bug -s "Something broke" -b "Description here"
  jira-axi issue assign PRJ-123 -a user@example.com
  jira-axi issue move PRJ-123 "In Progress"
  jira-axi issue comment PRJ-123 -b "My comment"`;

/**
 * Inject non-interactive flags that jira-cli requires from an agent context:
 * - --plain for list/view subcommands (disables the TUI)
 * - --no-input for mutating subcommands (disables interactive prompts)
 */
function injectFlags(sub: string, args: string[]): string[] {
  const out = [...args];
  if (TUI_SUBS.has(sub) && !out.includes("--plain") && !out.includes("--raw")) {
    out.push("--plain");
  }
  if (MUTATING_SUBS.has(sub) && !out.includes("--no-input")) {
    out.push("--no-input");
  }
  return out;
}

export async function issueCommand(args: string[]): Promise<string> {
  const sub = args[0];

  if (sub === "--help" || sub === undefined) return ISSUE_HELP;

  const injected = injectFlags(sub, args.slice(1));
  const jiraArgs = ["issue", sub, ...injected];
  return jiraExec(jiraArgs);
}
