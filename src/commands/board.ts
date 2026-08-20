import { jiraExec } from "../jira.js";

const TUI_SUBS = new Set(["list"]);

export const BOARD_HELP = `usage: jira-axi board <subcommand> [flags]
subcommands[1]:
  list
notes:
  --plain is injected automatically for list subcommand
flags{list}:
  --paginate <from:limit>, --plain (injected), --raw
examples:
  jira-axi board list`;

function injectFlags(sub: string, args: string[]): string[] {
  const out = [...args];
  if (TUI_SUBS.has(sub) && !out.includes("--plain") && !out.includes("--raw")) {
    out.push("--plain");
  }
  return out;
}

export async function boardCommand(args: string[]): Promise<string> {
  const sub = args[0];

  if (sub === "--help" || sub === undefined) return BOARD_HELP;

  const injected = injectFlags(sub, args.slice(1));
  const jiraArgs = ["board", sub, ...injected];
  return jiraExec(jiraArgs);
}
