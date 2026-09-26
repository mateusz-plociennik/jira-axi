import {
  parseCount,
  positionals,
  pushRepeated,
  rejectUnknownFlags,
  requireIssueKey,
  takeAllFlags,
  takeBoolFlag,
  takeFlag,
} from "../args.js";
import { resolveBody } from "../body.js";
import { AxiError } from "../errors.js";
import { normalizeIssue, truncate, type NormalizedIssue } from "../fields.js";
import { formatCountLine } from "../format.js";
import { jiraExec, jiraJson, type JiraContext } from "../jira.js";
import { getSuggestions } from "../suggestions.js";
import {
  custom,
  encode,
  field,
  joinArray,
  relativeTime,
  renderHelp,
  renderList,
  renderOutput,
} from "../toon.js";
import { resolveUser } from "../user.js";

export const ISSUE_HELP = `usage: jira-axi issue <subcommand> [args] [flags]
subcommands[12]:
  list, view <KEY>, create, edit <KEY>, assign <KEY> <user>, move <KEY> <state>,
  comment add <KEY> <body>, link <IN> <OUT> <TYPE>, unlink <IN> <OUT>,
  clone <KEY>, delete <KEY>, worklog add <KEY> <time>
flags{list}:
  [text], -q/--jql <jql>, -s/--status <name> (repeatable, ~Name negates), -a/--assignee <user|me|x>,
  -r/--reporter <user|me>, -t/--type <name>, -y/--priority <name>, -l/--label <name> (repeatable),
  -C/--component <name>, -P/--parent <KEY>, -R/--resolution <name>, --created/--updated <today|week|-7d|yyyy-mm-dd>,
  --created-after/--created-before/--updated-after/--updated-before, --order-by <field>, --reverse,
  --history, --watching, --limit <n> (default 30), --from <n>, --fields <a,b,c>
flags{view}:
  --comments <n> (default 3), --full (no description truncation)
flags{create}:
  -t/--type <name> (required), -s/--summary <text> (required), -b/--body <text>, --body-file <path>,
  -y/--priority, -a/--assignee, -r/--reporter, -l/--label (repeatable), -C/--component (repeatable),
  -P/--parent <KEY>, --custom <key=value> (repeatable), --fix-version, --affects-version, -e/--original-estimate
flags{edit}:
  -s/--summary, -b/--body, --body-file, -y/--priority, -a/--assignee, -P/--parent,
  -l/--label (repeatable), --remove-label (repeatable), -C/--component, --fix-version, --custom, --skip-notify
flags{move}:
  --comment <text>, -R/--resolution <name>, -a/--assignee <user|me>
flags{comment add}:
  -b/--body <text>, --body-file <path>, --internal
flags{clone}:
  -s/--summary, -y/--priority, -a/--assignee, -P/--parent, -l/--label, -C/--component, -H/--replace <find:replace>
flags{delete}:
  --cascade
flags{worklog add}:
  --comment <text>, --started <datetime>, --timezone <tz>, --new-estimate <estimate>
examples:
  jira-axi issue list --assignee me --status "In Progress"
  jira-axi issue list --jql "sprint in openSprints() AND status != Done"
  jira-axi issue view PROJ-42
  jira-axi issue create --type Bug --summary "Login fails" --body "Steps..."
  jira-axi issue move PROJ-42 "In Progress"
  jira-axi issue comment add PROJ-42 "Deployed to staging"`;

const DEFAULT_LIMIT = 30;
const DESCRIPTION_LIMIT = 2000;
const COMMENT_LIMIT = 600;

const BASE_LIST_FIELDS = [
  "key",
  "type",
  "status",
  "summary",
  "assignee",
  "priority",
  "updated",
] as const;

const EXTRA_LIST_FIELDS: Record<string, (issue: NormalizedIssue) => unknown> = {
  reporter: (issue) => issue.reporter,
  labels: (issue) => (issue.labels.length ? issue.labels.join(",") : "none"),
  components: (issue) => (issue.components.length ? issue.components.join(",") : "none"),
  parent: (issue) => issue.parent || "none",
  resolution: (issue) => issue.resolution,
  created: (issue) => issue.created,
};

/** Build the `jira issue list` argv shared by list, home, and epic listings. */
export async function buildListArgs(
  args: string[],
  ctx: JiraContext | undefined,
  base: string[] = ["issue", "list"],
): Promise<{ argv: string[]; limit: number }> {
  const jql = takeFlag(args, "--jql", "-q");
  const statuses = takeAllFlags(args, "--status", "-s");
  const labels = takeAllFlags(args, "--label", "-l");
  const assignee = await resolveUser(takeFlag(args, "--assignee", "-a"), ctx);
  const reporter = await resolveUser(takeFlag(args, "--reporter", "-r"), ctx);
  const type = takeFlag(args, "--type", "-t");
  const priority = takeFlag(args, "--priority", "-y");
  const component = takeFlag(args, "--component", "-C");
  const parent = takeFlag(args, "--parent", "-P");
  const resolution = takeFlag(args, "--resolution", "-R");
  const created = takeFlag(args, "--created");
  const updated = takeFlag(args, "--updated");
  const createdAfter = takeFlag(args, "--created-after");
  const createdBefore = takeFlag(args, "--created-before");
  const updatedAfter = takeFlag(args, "--updated-after");
  const updatedBefore = takeFlag(args, "--updated-before");
  const orderBy = takeFlag(args, "--order-by");
  const reverse = takeBoolFlag(args, "--reverse");
  const history = takeBoolFlag(args, "--history");
  const watching = takeBoolFlag(args, "--watching");
  const limit = parseCount(takeFlag(args, "--limit"), "--limit", DEFAULT_LIMIT);
  const from = parseCount(takeFlag(args, "--from"), "--from", 0);

  const argv = [...base];
  if (jql) argv.push("--jql", jql);
  pushRepeated(argv, "--status", statuses);
  pushRepeated(argv, "--label", labels);
  if (assignee) argv.push("--assignee", assignee);
  if (reporter) argv.push("--reporter", reporter);
  if (type) argv.push("--type", type);
  if (priority) argv.push("--priority", priority);
  if (component) argv.push("--component", component);
  if (parent) argv.push("--parent", parent);
  if (resolution) argv.push("--resolution", resolution);
  if (created) argv.push("--created", created);
  if (updated) argv.push("--updated", updated);
  if (createdAfter) argv.push("--created-after", createdAfter);
  if (createdBefore) argv.push("--created-before", createdBefore);
  if (updatedAfter) argv.push("--updated-after", updatedAfter);
  if (updatedBefore) argv.push("--updated-before", updatedBefore);
  if (orderBy) argv.push("--order-by", orderBy);
  if (reverse) argv.push("--reverse");
  if (history) argv.push("--history");
  if (watching) argv.push("--watching");
  argv.push("--paginate", `${from}:${limit}`);

  return { argv, limit };
}

function listSchema(extraFields: string[]) {
  const schema = BASE_LIST_FIELDS.map((name) =>
    name === "updated" ? relativeTime("updated") : field(name),
  );
  for (const name of extraFields) {
    const extractor = EXTRA_LIST_FIELDS[name];
    if (!extractor) {
      throw new AxiError(`Unknown field "${name}"`, "VALIDATION_ERROR", [
        `Available --fields values: ${Object.keys(EXTRA_LIST_FIELDS).join(", ")}`,
      ]);
    }
    schema.push(custom(name, (item) => extractor(item as NormalizedIssue)));
  }
  return schema;
}

export async function listIssues(args: string[], ctx?: JiraContext): Promise<string> {
  const extraFields = (takeFlag(args, "--fields") ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  const { argv, limit } = await buildListArgs(args, ctx);
  const text = positionals(args)[1];
  rejectUnknownFlags(args, "Run `jira-axi issue list --help` for supported flags");
  if (text) argv.push(text);
  argv.push("--raw");

  const raw = await jiraJson<Record<string, unknown>[]>(argv, ctx).catch((error: unknown) => {
    // jira-cli exits non-zero with "No result found" when a query matches nothing.
    if (error instanceof AxiError && /No result found/i.test(error.message)) return [];
    throw error;
  });
  const issues = (Array.isArray(raw) ? raw : []).map(normalizeIssue);

  return renderOutput([
    formatCountLine({ count: issues.length, limit }),
    issues.length ? renderList("issues", issues, listSchema(extraFields)) : "issues: none",
    renderHelp(
      getSuggestions({
        domain: "issue",
        action: "list",
        isEmpty: issues.length === 0,
        key: issues[0]?.key,
      }),
    ),
  ]);
}

export async function viewIssue(args: string[], ctx?: JiraContext): Promise<string> {
  const commentCount = parseCount(takeFlag(args, "--comments"), "--comments", 3);
  const full = takeBoolFlag(args, "--full");
  const key = requireIssueKey(positionals(args)[1], "Run `jira-axi issue view <KEY>`");
  rejectUnknownFlags(args, "Run `jira-axi issue view --help` for supported flags");

  const raw = await jiraJson<Record<string, unknown>>(
    ["issue", "view", key, "--comments", String(commentCount), "--raw"],
    ctx,
  );
  const issue = normalizeIssue(raw);
  const description = full
    ? { text: issue.description, truncated: false }
    : truncate(issue.description, DESCRIPTION_LIMIT);

  const blocks = [
    encode({
      issue: {
        key: issue.key,
        type: issue.type,
        status: issue.status,
        summary: issue.summary,
        assignee: issue.assignee,
        reporter: issue.reporter,
        priority: issue.priority,
        resolution: issue.resolution,
        parent: issue.parent || "none",
        labels: issue.labels.length ? issue.labels.join(",") : "none",
        components: issue.components.length ? issue.components.join(",") : "none",
        created: issue.created,
        updated: issue.updated,
      },
    }),
  ];

  if (description.text) {
    blocks.push(encode({ description: description.text }));
    if (description.truncated) {
      blocks.push("description_truncated: true (re-run with --full)");
    }
  }
  if (issue.subtasks.length) {
    blocks.push(
      renderList("subtasks", issue.subtasks, [field("key"), field("status"), field("summary")]),
    );
  }
  if (issue.links.length) {
    blocks.push(
      renderList("links", issue.links, [field("type"), field("key"), field("summary")]),
    );
  }
  if (issue.comments.length) {
    const comments = issue.comments.slice(-commentCount).map((comment) => ({
      ...comment,
      body: truncate(comment.body, COMMENT_LIMIT).text,
    }));
    blocks.push(
      renderList("comments", comments, [
        field("author"),
        relativeTime("created"),
        field("body"),
      ]),
    );
  }
  blocks.push(renderHelp(getSuggestions({ domain: "issue", action: "view", key: issue.key })));

  return renderOutput(blocks);
}

/** jira-cli reports mutations as "<thing> created\n<server>/browse/KEY". */
export function extractIssueKey(stdout: string): string | undefined {
  const match = stdout.match(/([A-Z][A-Z0-9_]*-\d+)\s*$/m);
  return match?.[1];
}

async function createIssue(args: string[], ctx?: JiraContext): Promise<string> {
  const type = takeFlag(args, "--type", "-t");
  const summary = takeFlag(args, "--summary", "-s");
  const body = resolveBody(
    takeFlag(args, "--body", "-b"),
    takeFlag(args, "--body-file"),
    'Run `jira-axi issue create --type Bug --summary "..." --body "..."`',
  );
  const priority = takeFlag(args, "--priority", "-y");
  const assignee = await resolveUser(takeFlag(args, "--assignee", "-a"), ctx);
  const reporter = await resolveUser(takeFlag(args, "--reporter", "-r"), ctx);
  const parent = takeFlag(args, "--parent", "-P");
  const estimate = takeFlag(args, "--original-estimate", "-e");
  const labels = takeAllFlags(args, "--label", "-l");
  const components = takeAllFlags(args, "--component", "-C");
  const fixVersions = takeAllFlags(args, "--fix-version");
  const affectsVersions = takeAllFlags(args, "--affects-version");
  const customFields = takeAllFlags(args, "--custom");
  rejectUnknownFlags(args, "Run `jira-axi issue create --help` for supported flags");

  if (!type || !summary) {
    throw new AxiError(
      "--type and --summary are required when creating an issue",
      "VALIDATION_ERROR",
      ['Run `jira-axi issue create --type Bug --summary "..."`'],
    );
  }

  const argv = ["issue", "create", "--no-input", "--raw", "--type", type, "--summary", summary];
  if (body !== undefined) argv.push("--body", body);
  if (priority) argv.push("--priority", priority);
  if (assignee) argv.push("--assignee", assignee);
  if (reporter) argv.push("--reporter", reporter);
  if (parent) argv.push("--parent", parent);
  if (estimate) argv.push("--original-estimate", estimate);
  pushRepeated(argv, "--label", labels);
  pushRepeated(argv, "--component", components);
  pushRepeated(argv, "--fix-version", fixVersions);
  pushRepeated(argv, "--affects-version", affectsVersions);
  pushRepeated(argv, "--custom", customFields);

  const created = await jiraJson<{ key?: string }>(argv, ctx);
  const key = created?.key ?? "unknown";
  return renderOutput([
    encode({ created: "ok", key }),
    renderHelp(getSuggestions({ domain: "issue", action: "create", key })),
  ]);
}

async function editIssue(args: string[], ctx?: JiraContext): Promise<string> {
  const summary = takeFlag(args, "--summary", "-s");
  const body = resolveBody(
    takeFlag(args, "--body", "-b"),
    takeFlag(args, "--body-file"),
    "Run `jira-axi issue edit <KEY> --body-file <path>`",
  );
  const priority = takeFlag(args, "--priority", "-y");
  const assignee = await resolveUser(takeFlag(args, "--assignee", "-a"), ctx);
  const parent = takeFlag(args, "--parent", "-P");
  const labels = takeAllFlags(args, "--label", "-l");
  const removeLabels = takeAllFlags(args, "--remove-label");
  const components = takeAllFlags(args, "--component", "-C");
  const fixVersions = takeAllFlags(args, "--fix-version");
  const customFields = takeAllFlags(args, "--custom");
  const skipNotify = takeBoolFlag(args, "--skip-notify");
  const key = requireIssueKey(positionals(args)[1], "Run `jira-axi issue edit <KEY> [flags]`");
  rejectUnknownFlags(args, "Run `jira-axi issue edit --help` for supported flags");

  const argv = ["issue", "edit", key, "--no-input"];
  if (summary) argv.push("--summary", summary);
  if (body !== undefined) argv.push("--body", body);
  if (priority) argv.push("--priority", priority);
  if (assignee) argv.push("--assignee", assignee);
  if (parent) argv.push("--parent", parent);
  pushRepeated(argv, "--label", labels);
  pushRepeated(
    argv,
    "--label",
    removeLabels.map((label) => `-${label}`),
  );
  pushRepeated(argv, "--component", components);
  pushRepeated(argv, "--fix-version", fixVersions);
  pushRepeated(argv, "--custom", customFields);
  if (skipNotify) argv.push("--skip-notify");

  await jiraExec(argv, ctx);
  return renderOutput([
    encode({ edited: "ok", key }),
    renderHelp(getSuggestions({ domain: "issue", action: "edit", key })),
  ]);
}

async function assignIssue(args: string[], ctx?: JiraContext): Promise<string> {
  const [, key, user] = positionals(args);
  requireIssueKey(key, "Run `jira-axi issue assign <KEY> <user|me|x|default>`");
  if (!user) {
    throw new AxiError("Missing assignee", "VALIDATION_ERROR", [
      "Run `jira-axi issue assign <KEY> <user|me|x|default>` — `x` unassigns",
    ]);
  }
  rejectUnknownFlags(args, "Run `jira-axi issue assign <KEY> <user|me|x|default>`");

  const resolved = (await resolveUser(user, ctx)) ?? user;
  await jiraExec(["issue", "assign", key, resolved], ctx);
  return renderOutput([
    encode({ assigned: "ok", key, assignee: resolved === "x" ? "unassigned" : resolved }),
    renderHelp(getSuggestions({ domain: "issue", action: "assign", key })),
  ]);
}

async function moveIssue(args: string[], ctx?: JiraContext): Promise<string> {
  const comment = takeFlag(args, "--comment");
  const resolution = takeFlag(args, "--resolution", "-R");
  const assignee = await resolveUser(takeFlag(args, "--assignee", "-a"), ctx);
  const [, key, state] = positionals(args);
  requireIssueKey(key, 'Run `jira-axi issue move <KEY> "<state>"`');
  if (!state) {
    throw new AxiError("Missing target state", "VALIDATION_ERROR", [
      'Run `jira-axi issue move <KEY> "In Progress"` — jira-axi never opens the interactive state picker',
    ]);
  }
  rejectUnknownFlags(args, "Run `jira-axi issue move --help` for supported flags");

  const argv = ["issue", "move", key, state];
  if (comment) argv.push("--comment", comment);
  if (resolution) argv.push("--resolution", resolution);
  if (assignee) argv.push("--assignee", assignee);

  await jiraExec(argv, ctx);
  return renderOutput([
    encode({ moved: "ok", key, status: state }),
    renderHelp(getSuggestions({ domain: "issue", action: "move", key })),
  ]);
}

async function addComment(args: string[], ctx?: JiraContext): Promise<string> {
  const internal = takeBoolFlag(args, "--internal");
  const flagBody = resolveBody(
    takeFlag(args, "--body", "-b"),
    takeFlag(args, "--body-file"),
    'Run `jira-axi issue comment add <KEY> "..."`',
  );
  const [, , key, positionalBody] = positionals(args);
  requireIssueKey(key, 'Run `jira-axi issue comment add <KEY> "..."`');
  const body = flagBody ?? positionalBody;
  if (!body) {
    throw new AxiError("Missing comment body", "VALIDATION_ERROR", [
      'Run `jira-axi issue comment add <KEY> "..."` or pass --body-file <path>',
    ]);
  }
  rejectUnknownFlags(args, "Run `jira-axi issue comment add --help` for supported flags");

  const argv = ["issue", "comment", "add", key, body, "--no-input"];
  if (internal) argv.push("--internal");

  await jiraExec(argv, ctx);
  return renderOutput([
    encode({ commented: "ok", key }),
    renderHelp(getSuggestions({ domain: "issue", action: "comment", key })),
  ]);
}

async function linkIssue(args: string[], ctx?: JiraContext): Promise<string> {
  const parts = positionals(args);
  if (parts[1] === "remote") {
    const [, , key, url, title] = parts;
    if (!key || !url || !title) {
      throw new AxiError("Missing remote link arguments", "VALIDATION_ERROR", [
        'Run `jira-axi issue link remote <KEY> <url> "<title>"`',
      ]);
    }
    await jiraExec(["issue", "link", "remote", key, url, title], ctx);
    return renderOutput([
      encode({ linked: "ok", key, remote: url }),
      renderHelp(getSuggestions({ domain: "issue", action: "link", key })),
    ]);
  }

  const [, inward, outward, type] = parts;
  if (!inward || !outward || !type) {
    throw new AxiError("Missing link arguments", "VALIDATION_ERROR", [
      'Run `jira-axi issue link <INWARD-KEY> <OUTWARD-KEY> "<link type>"`, e.g. type "Blocks"',
    ]);
  }
  await jiraExec(["issue", "link", inward, outward, type], ctx);
  return renderOutput([
    encode({ linked: "ok", inward, outward, type }),
    renderHelp(getSuggestions({ domain: "issue", action: "link", key: inward })),
  ]);
}

async function unlinkIssue(args: string[], ctx?: JiraContext): Promise<string> {
  const [, inward, outward] = positionals(args);
  if (!inward || !outward) {
    throw new AxiError("Missing unlink arguments", "VALIDATION_ERROR", [
      "Run `jira-axi issue unlink <INWARD-KEY> <OUTWARD-KEY>`",
    ]);
  }
  await jiraExec(["issue", "unlink", inward, outward], ctx);
  return renderOutput([
    encode({ unlinked: "ok", inward, outward }),
    renderHelp(getSuggestions({ domain: "issue", action: "unlink", key: inward })),
  ]);
}

async function cloneIssue(args: string[], ctx?: JiraContext): Promise<string> {
  const summary = takeFlag(args, "--summary", "-s");
  const priority = takeFlag(args, "--priority", "-y");
  const assignee = await resolveUser(takeFlag(args, "--assignee", "-a"), ctx);
  const parent = takeFlag(args, "--parent", "-P");
  const labels = takeAllFlags(args, "--label", "-l");
  const components = takeAllFlags(args, "--component", "-C");
  const replacements = takeAllFlags(args, "--replace", "-H");
  const key = requireIssueKey(positionals(args)[1], "Run `jira-axi issue clone <KEY>`");
  rejectUnknownFlags(args, "Run `jira-axi issue clone --help` for supported flags");

  const argv = ["issue", "clone", key];
  if (summary) argv.push("--summary", summary);
  if (priority) argv.push("--priority", priority);
  if (assignee) argv.push("--assignee", assignee);
  if (parent) argv.push("--parent", parent);
  pushRepeated(argv, "--label", labels);
  pushRepeated(argv, "--component", components);
  pushRepeated(argv, "--replace", replacements);

  const stdout = await jiraExec(argv, ctx);
  const cloned = extractIssueKey(stdout);
  return renderOutput([
    encode({ cloned: "ok", source: key, key: cloned ?? "unknown" }),
    renderHelp(getSuggestions({ domain: "issue", action: "create", key: cloned ?? key })),
  ]);
}

async function deleteIssue(args: string[], ctx?: JiraContext): Promise<string> {
  const cascade = takeBoolFlag(args, "--cascade");
  const key = requireIssueKey(positionals(args)[1], "Run `jira-axi issue delete <KEY>`");
  rejectUnknownFlags(args, "Run `jira-axi issue delete <KEY> [--cascade]`");

  const argv = ["issue", "delete", key];
  if (cascade) argv.push("--cascade");
  await jiraExec(argv, ctx);
  return renderOutput([
    encode({ deleted: "ok", key, cascade: cascade ? "yes" : "no" }),
    renderHelp(getSuggestions({ domain: "issue", action: "delete", key })),
  ]);
}

async function addWorklog(args: string[], ctx?: JiraContext): Promise<string> {
  const comment = takeFlag(args, "--comment");
  const started = takeFlag(args, "--started");
  const timezone = takeFlag(args, "--timezone");
  const newEstimate = takeFlag(args, "--new-estimate");
  const [, , key, timeSpent] = positionals(args);
  requireIssueKey(key, 'Run `jira-axi issue worklog add <KEY> "2h 30m"`');
  if (!timeSpent) {
    throw new AxiError("Missing time spent", "VALIDATION_ERROR", [
      'Run `jira-axi issue worklog add <KEY> "2h 30m"`',
    ]);
  }
  rejectUnknownFlags(args, "Run `jira-axi issue worklog add --help` for supported flags");

  const argv = ["issue", "worklog", "add", key, timeSpent, "--no-input"];
  if (comment) argv.push("--comment", comment);
  if (started) argv.push("--started", started);
  if (timezone) argv.push("--timezone", timezone);
  if (newEstimate) argv.push("--new-estimate", newEstimate);

  await jiraExec(argv, ctx);
  return renderOutput([
    encode({ worklog: "ok", key, time_spent: timeSpent }),
    renderHelp(getSuggestions({ domain: "issue", action: "worklog", key })),
  ]);
}

export async function issueCommand(args: string[], ctx?: JiraContext): Promise<string> {
  const sub = args[0];
  if (sub === undefined || sub === "--help") return ISSUE_HELP;

  switch (sub) {
    case "list":
    case "ls":
    case "search":
      return listIssues(args, ctx);
    case "view":
    case "show":
      return viewIssue(args, ctx);
    case "create":
      return createIssue(args, ctx);
    case "edit":
    case "update":
      return editIssue(args, ctx);
    case "assign":
      return assignIssue(args, ctx);
    case "move":
    case "transition":
      return moveIssue(args, ctx);
    case "comment":
      if (args[1] !== "add") {
        throw new AxiError(`Unknown comment action: ${args[1] ?? "(none)"}`, "VALIDATION_ERROR", [
          'Run `jira-axi issue comment add <KEY> "..."`',
        ]);
      }
      return addComment(args, ctx);
    case "link":
      return linkIssue(args, ctx);
    case "unlink":
      return unlinkIssue(args, ctx);
    case "clone":
      return cloneIssue(args, ctx);
    case "delete":
      return deleteIssue(args, ctx);
    case "worklog":
      if (args[1] !== "add") {
        throw new AxiError(`Unknown worklog action: ${args[1] ?? "(none)"}`, "VALIDATION_ERROR", [
          'Run `jira-axi issue worklog add <KEY> "2h"`',
        ]);
      }
      return addWorklog(args, ctx);
    default:
      throw new AxiError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, view, create, edit, assign, move, comment, link, unlink, clone, delete, worklog",
      ]);
  }
}
