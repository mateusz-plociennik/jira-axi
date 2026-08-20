import { jiraExec } from "../jira.js";

const TUI_SUBS = new Set(["list"]);

export const SPRINT_HELP = `usage: jira-axi sprint <subcommand> [flags]
subcommands[2]:
  list, add
notes:
  --plain is injected automatically for list subcommand
flags{list}:
  -s/--status (repeatable), --paginate <from:limit>, --plain (injected), --raw
flags{add}:
  <sprint-id> <issue-key> [<issue-key> ...]
examples:
  jira-axi sprint list
  jira-axi sprint add 42 PRJ-123 PRJ-124`;

function injectFlags(sub: string, args: string[]): string[] {
  const out = [...args];
  if (TUI_SUBS.has(sub) && !out.includes("--plain") && !out.includes("--raw")) {
    out.push("--plain");
  }
  return out;
}

export async function sprintCommand(args: string[]): Promise<string> {
  const sub = args[0];

  if (sub === "--help" || sub === undefined) return SPRINT_HELP;

  const injected = injectFlags(sub, args.slice(1));
  const jiraArgs = ["sprint", sub, ...injected];
  return jiraExec(jiraArgs);
}
