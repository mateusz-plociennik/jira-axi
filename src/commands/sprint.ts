import {
  positionals,
  rejectUnknownFlags,
  takeBoolFlag,
  takeFlag,
} from "../args.js";
import { AxiError } from "../errors.js";
import { formatCountLine } from "../format.js";
import { jiraExec, type JiraContext } from "../jira.js";
import { getSuggestions } from "../suggestions.js";
import { encode, field, renderHelp, renderList, renderOutput } from "../toon.js";
import { parseCsvRecords, parseTabTable } from "../table.js";
import { buildListArgs } from "./issue.js";

export const SPRINT_HELP = `usage: jira-axi sprint <subcommand> [args] [flags]
subcommands[3]:
  list [SPRINT_ID], add <SPRINT_ID> <ISSUE-KEY...>, close <SPRINT_ID>
flags{list}:
  --current, --prev, --next, --state <future|active|closed>, --limit <n>,
  --show-all-issues, plus the \`issue list\` filters when listing sprint issues
examples:
  jira-axi sprint list
  jira-axi sprint list --current
  jira-axi sprint list 42
  jira-axi sprint add 42 PROJ-1 PROJ-2
  jira-axi sprint close 42`;

const SPRINT_COLUMNS = ["id", "name", "state", "start", "end"];
const SPRINT_ISSUE_COLUMNS = ["type", "key", "status", "summary", "assignee"];

async function listSprints(args: string[], ctx?: JiraContext): Promise<string> {
  const current = takeBoolFlag(args, "--current");
  const previous = takeBoolFlag(args, "--prev");
  const next = takeBoolFlag(args, "--next");
  const showAllIssues = takeBoolFlag(args, "--show-all-issues");
  const state = takeFlag(args, "--state");
  const id = positionals(args)[1];
  const issueMode = Boolean(id || current || previous || next);
  const { argv, limit } = await buildListArgs(
    args,
    ctx,
    id ? ["sprint", "list", id] : ["sprint", "list"],
  );
  rejectUnknownFlags(args, "Run `jira-axi sprint list --help` for supported flags");

  if (current) argv.push("--current");
  if (previous) argv.push("--prev");
  if (next) argv.push("--next");
  if (showAllIssues) argv.push("--show-all-issues");
  if (state) argv.push("--state", state);
  argv.push("--plain", "--no-headers");

  if (issueMode) {
    argv.push("--csv", "--columns", SPRINT_ISSUE_COLUMNS.join(","));
    const stdout = await jiraExec(argv, ctx).catch((error: unknown) => {
      if (error instanceof AxiError && /No result found/i.test(error.message)) return "";
      throw error;
    });
    const issues = parseCsvRecords(stdout, SPRINT_ISSUE_COLUMNS);
    return renderOutput([
      formatCountLine({ count: issues.length, limit }),
      issues.length
        ? renderList("issues", issues, SPRINT_ISSUE_COLUMNS.map((column) => field(column)))
        : "issues: none",
      renderHelp(getSuggestions({ domain: "issue", action: "list", key: issues[0]?.["key"] })),
    ]);
  }

  // Sprint metadata has no CSV mode in jira-cli; it prints a tab-aligned table.
  argv.push("--columns", SPRINT_COLUMNS.join(","));
  const stdout = await jiraExec(argv, ctx).catch((error: unknown) => {
    if (error instanceof AxiError && /No result found/i.test(error.message)) return "";
    throw error;
  });
  const sprints = parseTabTable(stdout, {
    columns: SPRINT_COLUMNS,
    hasHeader: false,
  });

  return renderOutput([
    formatCountLine({ count: sprints.length }),
    sprints.length
      ? renderList("sprints", sprints, SPRINT_COLUMNS.map((column) => field(column)))
      : "sprints: none",
    renderHelp(
      getSuggestions({ domain: "sprint", action: "list", isEmpty: sprints.length === 0 }),
    ),
  ]);
}

async function addToSprint(args: string[], ctx?: JiraContext): Promise<string> {
  const [, sprint, ...issues] = positionals(args);
  if (!sprint || issues.length === 0) {
    throw new AxiError("Missing sprint id or issue keys", "VALIDATION_ERROR", [
      "Run `jira-axi sprint add <SPRINT_ID> <ISSUE-KEY> [ISSUE-KEY...]`",
    ]);
  }
  rejectUnknownFlags(args, "Run `jira-axi sprint add <SPRINT_ID> <ISSUE-KEY...>`");

  await jiraExec(["sprint", "add", sprint, ...issues], ctx);
  return renderOutput([
    encode({ added: "ok", sprint, issues: issues.join(",") }),
    renderHelp(getSuggestions({ domain: "sprint", action: "add", key: sprint })),
  ]);
}

async function closeSprint(args: string[], ctx?: JiraContext): Promise<string> {
  const sprint = positionals(args)[1];
  if (!sprint) {
    throw new AxiError("Missing sprint id", "VALIDATION_ERROR", [
      "Run `jira-axi sprint close <SPRINT_ID>`",
    ]);
  }
  rejectUnknownFlags(args, "Run `jira-axi sprint close <SPRINT_ID>`");

  await jiraExec(["sprint", "close", sprint], ctx);
  return renderOutput([
    encode({ closed: "ok", sprint }),
    renderHelp(["Run `jira-axi sprint list` to see the remaining sprints"]),
  ]);
}

export async function sprintCommand(args: string[], ctx?: JiraContext): Promise<string> {
  const sub = args[0];
  if (sub === undefined || sub === "--help") return SPRINT_HELP;
  switch (sub) {
    case "list":
    case "ls":
      return listSprints(args, ctx);
    case "add":
    case "assign":
      return addToSprint(args, ctx);
    case "close":
    case "complete":
      return closeSprint(args, ctx);
    default:
      throw new AxiError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, add, close",
      ]);
  }
}
