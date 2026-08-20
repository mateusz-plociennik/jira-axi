import { positionals, rejectUnknownFlags } from "../args.js";
import { AxiError } from "../errors.js";
import { formatCountLine } from "../format.js";
import { jiraExec, type JiraContext } from "../jira.js";
import { getSuggestions } from "../suggestions.js";
import { encode, field, renderHelp, renderList, renderOutput } from "../toon.js";
import { parseTabTable } from "../table.js";

export const BOARD_HELP = `usage: jira-axi board list
Lists the boards jira-cli can see for the configured project.

examples:
  jira-axi board list
  jira-axi board list --project OTHER`;

export const PROJECT_HELP = `usage: jira-axi project list
Lists the Jira projects the authenticated user can access.

examples:
  jira-axi project list`;

export const RELEASE_HELP = `usage: jira-axi release list
Lists releases (versions) of the configured project.

examples:
  jira-axi release list
  jira-axi release list --project OTHER`;

/**
 * `board`, `project`, and `release` listings have no JSON or CSV mode in
 * jira-cli — they always print a tab-aligned table — so the header row is used
 * to key the parsed records.
 */
async function listTable(
  argv: string[],
  label: string,
  columns: string[],
  domain: string,
  ctx?: JiraContext,
): Promise<string> {
  const stdout = await jiraExec(argv, ctx);
  const rows = parseTabTable(stdout, { hasHeader: true, columns });
  return renderOutput([
    formatCountLine({ count: rows.length }),
    rows.length
      ? renderList(label, rows, columns.map((column) => field(column)))
      : `${label}: none`,
    renderHelp(getSuggestions({ domain, action: "list", isEmpty: rows.length === 0 })),
  ]);
}

function requireListSubcommand(args: string[], help: string, usage: string): string | undefined {
  const sub = args[0];
  if (sub === undefined || sub === "--help") return help;
  if (sub !== "list" && sub !== "ls") {
    throw new AxiError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [usage]);
  }
  rejectUnknownFlags(args.slice(1), usage);
  if (positionals(args).length > 1) {
    throw new AxiError(`Unexpected argument: ${positionals(args)[1]}`, "VALIDATION_ERROR", [usage]);
  }
  return undefined;
}

export async function boardCommand(args: string[], ctx?: JiraContext): Promise<string> {
  const early = requireListSubcommand(args, BOARD_HELP, "Run `jira-axi board list`");
  if (early !== undefined) return early;
  return listTable(["board", "list"], "boards", ["id", "name", "type"], "board", ctx);
}

export async function projectCommand(args: string[], ctx?: JiraContext): Promise<string> {
  const early = requireListSubcommand(args, PROJECT_HELP, "Run `jira-axi project list`");
  if (early !== undefined) return early;
  return listTable(["project", "list"], "projects", ["key", "name", "type", "lead"], "project", ctx);
}

export async function releaseCommand(args: string[], ctx?: JiraContext): Promise<string> {
  const early = requireListSubcommand(args, RELEASE_HELP, "Run `jira-axi release list`");
  if (early !== undefined) return early;
  return listTable(
    ["release", "list"],
    "releases",
    ["id", "name", "released", "description"],
    "release",
    ctx,
  );
}

export const ME_HELP = `usage: jira-axi me
Prints the Jira account jira-cli is authenticated as. Use it to verify auth.`;

export async function meCommand(args: string[], ctx?: JiraContext): Promise<string> {
  if (args[0] === "--help") return ME_HELP;
  rejectUnknownFlags(args, "Run `jira-axi me`");
  const login = (await jiraExec(["me"], ctx)).trim();
  return renderOutput([
    encode({ user: login }),
    renderHelp(["Run `jira-axi issue list --assignee me` for your issues"]),
  ]);
}

export const OPEN_HELP = `usage: jira-axi open [ISSUE-KEY]
Prints the browser URL for an issue (or the project) without opening a browser.

examples:
  jira-axi open
  jira-axi open PROJ-42`;

export async function openCommand(args: string[], ctx?: JiraContext): Promise<string> {
  if (args[0] === "--help") return OPEN_HELP;
  const key = positionals(args)[0];
  rejectUnknownFlags(args, "Run `jira-axi open [ISSUE-KEY]`");

  // --no-browser keeps this a URL lookup: an agent has no browser to hand off to.
  const argv = ["open", "--no-browser"];
  if (key) argv.splice(1, 0, key);
  const stdout = await jiraExec(argv, ctx);
  const url = stdout
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^https?:\/\//.test(line));
  if (!url) {
    throw new AxiError("jira did not return a browse URL", "UNKNOWN");
  }
  return renderOutput([encode(key ? { key, url } : { url })]);
}
