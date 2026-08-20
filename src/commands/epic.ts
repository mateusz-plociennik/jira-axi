import {
  parseCount,
  positionals,
  pushRepeated,
  rejectUnknownFlags,
  takeAllFlags,
  takeBoolFlag,
  takeFlag,
} from "../args.js";
import { resolveBody } from "../body.js";
import { AxiError } from "../errors.js";
import { normalizeIssue } from "../fields.js";
import { formatCountLine } from "../format.js";
import { jiraExec, jiraJson, type JiraContext } from "../jira.js";
import { getSuggestions } from "../suggestions.js";
import { encode, field, relativeTime, renderHelp, renderList, renderOutput } from "../toon.js";
import { parseCsvRecords } from "../table.js";
import { resolveUser } from "../user.js";
import { buildListArgs, extractIssueKey } from "./issue.js";

export const EPIC_HELP = `usage: jira-axi epic <subcommand> [args] [flags]
subcommands[4]:
  list [EPIC-KEY], create, add <EPIC-KEY> <ISSUE-KEY...>, remove <ISSUE-KEY...>
flags{list}:
  same filters as \`issue list\` (--status, --assignee, --label, --jql, --limit, ...)
flags{create}:
  -n/--name <text> (required), -s/--summary <text> (required), -b/--body <text>, --body-file <path>,
  -y/--priority, -a/--assignee, -r/--reporter, -l/--label (repeatable), -C/--component (repeatable)
flags{add,remove}:
  --skip-notify
examples:
  jira-axi epic list
  jira-axi epic list PROJ-12
  jira-axi epic create --name "Checkout v2" --summary "Checkout v2"
  jira-axi epic add PROJ-12 PROJ-42 PROJ-43`;

const EPIC_ISSUE_COLUMNS = ["type", "key", "status", "summary", "assignee"];

async function listEpics(args: string[], ctx?: JiraContext): Promise<string> {
  const key = positionals(args)[1];
  const { argv, limit } = await buildListArgs(
    args,
    ctx,
    key ? ["epic", "list", key] : ["issue", "list"],
  );
  rejectUnknownFlags(args, "Run `jira-axi epic list --help` for supported flags");

  if (!key) {
    // Listing epics themselves is `issue list --type Epic`, which supports the
    // JSON `--raw` output that `epic list` itself ignores.
    if (!argv.includes("--type")) argv.push("--type", "Epic");
    argv.push("--raw");
    const raw = await jiraJson<Record<string, unknown>[]>(argv, ctx).catch((error: unknown) => {
      if (error instanceof AxiError && /No result found/i.test(error.message)) return [];
      throw error;
    });
    const epics = (Array.isArray(raw) ? raw : []).map(normalizeIssue);
    return renderOutput([
      formatCountLine({ count: epics.length, limit }),
      epics.length
        ? renderList("epics", epics, [
            field("key"),
            field("status"),
            field("summary"),
            field("assignee"),
            relativeTime("updated"),
          ])
        : "epics: none",
      renderHelp(
        getSuggestions({ domain: "epic", action: "list", isEmpty: epics.length === 0 }),
      ),
    ]);
  }

  // `epic list <KEY>` resolves epic membership server-side (epic link on classic
  // projects, parent on next-gen), which a plain `issue list` cannot reproduce.
  argv.push("--plain", "--csv", "--no-headers", "--columns", EPIC_ISSUE_COLUMNS.join(","));
  const stdout = await jiraExec(argv, ctx).catch((error: unknown) => {
    if (error instanceof AxiError && /No result found/i.test(error.message)) return "";
    throw error;
  });
  const issues = parseCsvRecords(stdout, EPIC_ISSUE_COLUMNS);

  return renderOutput([
    formatCountLine({ count: issues.length, limit }),
    issues.length
      ? renderList("issues", issues, EPIC_ISSUE_COLUMNS.map((column) => field(column)))
      : "issues: none",
    renderHelp(getSuggestions({ domain: "issue", action: "list", key: issues[0]?.["key"] })),
  ]);
}

async function createEpic(args: string[], ctx?: JiraContext): Promise<string> {
  const name = takeFlag(args, "--name", "-n");
  const summary = takeFlag(args, "--summary", "-s");
  const body = resolveBody(
    takeFlag(args, "--body", "-b"),
    takeFlag(args, "--body-file"),
    'Run `jira-axi epic create --name "..." --summary "..."`',
  );
  const priority = takeFlag(args, "--priority", "-y");
  const assignee = await resolveUser(takeFlag(args, "--assignee", "-a"), ctx);
  const reporter = await resolveUser(takeFlag(args, "--reporter", "-r"), ctx);
  const labels = takeAllFlags(args, "--label", "-l");
  const components = takeAllFlags(args, "--component", "-C");
  rejectUnknownFlags(args, "Run `jira-axi epic create --help` for supported flags");

  if (!name || !summary) {
    throw new AxiError(
      "--name and --summary are required when creating an epic",
      "VALIDATION_ERROR",
      ['Run `jira-axi epic create --name "Checkout v2" --summary "Checkout v2"`'],
    );
  }

  const argv = ["epic", "create", "--no-input", "--name", name, "--summary", summary];
  if (body !== undefined) argv.push("--body", body);
  if (priority) argv.push("--priority", priority);
  if (assignee) argv.push("--assignee", assignee);
  if (reporter) argv.push("--reporter", reporter);
  pushRepeated(argv, "--label", labels);
  pushRepeated(argv, "--component", components);

  const stdout = await jiraExec(argv, ctx);
  const key = extractIssueKey(stdout) ?? "unknown";
  return renderOutput([
    encode({ created: "ok", key, name }),
    renderHelp(getSuggestions({ domain: "epic", action: "create", key })),
  ]);
}

async function addToEpic(args: string[], ctx?: JiraContext): Promise<string> {
  const skipNotify = takeBoolFlag(args, "--skip-notify");
  const [, epic, ...issues] = positionals(args);
  if (!epic || issues.length === 0) {
    throw new AxiError("Missing epic key or issue keys", "VALIDATION_ERROR", [
      "Run `jira-axi epic add <EPIC-KEY> <ISSUE-KEY> [ISSUE-KEY...]`",
    ]);
  }
  rejectUnknownFlags(args, "Run `jira-axi epic add <EPIC-KEY> <ISSUE-KEY...> [--skip-notify]`");

  const argv = ["epic", "add", epic, ...issues];
  if (skipNotify) argv.push("--skip-notify");
  await jiraExec(argv, ctx);
  return renderOutput([
    encode({ added: "ok", epic, issues: issues.join(",") }),
    renderHelp(getSuggestions({ domain: "epic", action: "add", key: epic })),
  ]);
}

async function removeFromEpic(args: string[], ctx?: JiraContext): Promise<string> {
  const skipNotify = takeBoolFlag(args, "--skip-notify");
  const [, ...issues] = positionals(args);
  if (issues.length === 0) {
    throw new AxiError("Missing issue keys", "VALIDATION_ERROR", [
      "Run `jira-axi epic remove <ISSUE-KEY> [ISSUE-KEY...]`",
    ]);
  }
  rejectUnknownFlags(args, "Run `jira-axi epic remove <ISSUE-KEY...> [--skip-notify]`");

  const argv = ["epic", "remove", ...issues];
  if (skipNotify) argv.push("--skip-notify");
  await jiraExec(argv, ctx);
  return renderOutput([
    encode({ removed: "ok", issues: issues.join(",") }),
    renderHelp(getSuggestions({ domain: "epic", action: "remove", key: issues[0] })),
  ]);
}

export async function epicCommand(args: string[], ctx?: JiraContext): Promise<string> {
  const sub = args[0];
  if (sub === undefined || sub === "--help") return EPIC_HELP;
  switch (sub) {
    case "list":
    case "ls":
      return listEpics(args, ctx);
    case "create":
      return createEpic(args, ctx);
    case "add":
    case "assign":
      return addToEpic(args, ctx);
    case "remove":
    case "rm":
    case "unassign":
      return removeFromEpic(args, ctx);
    default:
      throw new AxiError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, create, add, remove",
      ]);
  }
}
