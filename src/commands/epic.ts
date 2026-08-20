import { jiraExec } from "../jira.js";

const TUI_SUBS = new Set(["list"]);
const MUTATING_SUBS = new Set(["create"]);

export const EPIC_HELP = `usage: jira-axi epic <subcommand> [flags]
subcommands[2]:
  list, create
notes:
  --plain is injected automatically for list subcommand
  --no-input is injected automatically for create subcommand
flags{list}:
  -s/--status (repeatable), --paginate <from:limit>, --plain (injected), --raw
flags{create}:
  -t/--type (default Epic), -s/--summary (required), -b/--body, -y/--priority,
  -a/--assignee, -l/--label (repeatable), --no-input (injected automatically), --raw
examples:
  jira-axi epic list
  jira-axi epic list -s "In Progress"
  jira-axi epic create -s "Big feature" -b "Description"`;

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

export async function epicCommand(args: string[]): Promise<string> {
  const sub = args[0];

  if (sub === "--help" || sub === undefined) return EPIC_HELP;

  const injected = injectFlags(sub, args.slice(1));
  const jiraArgs = ["epic", sub, ...injected];
  return jiraExec(jiraArgs);
}
