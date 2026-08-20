import { AxiError, installSessionStartHooks } from "axi-sdk-js";
import { normalizeIssue } from "../fields.js";
import { jiraExec, jiraJson, type JiraContext } from "../jira.js";
import { getSuggestions } from "../suggestions.js";
import { encode, field, relativeTime, renderHelp, renderList, renderOutput } from "../toon.js";

export const HOME_HELP = "";

const HOME_LIMIT = 5;

const homeSchema = [
  field("key"),
  field("status"),
  field("summary"),
  field("priority"),
  relativeTime("updated"),
];

async function safeIssues(
  argv: string[],
  ctx?: JiraContext,
): Promise<ReturnType<typeof normalizeIssue>[]> {
  try {
    const raw = await jiraJson<Record<string, unknown>[]>(argv, ctx);
    return (Array.isArray(raw) ? raw : []).map(normalizeIssue);
  } catch {
    return [];
  }
}

/**
 * Zero-argument dashboard: who jira-cli is authenticated as, what is assigned
 * to that user, and what changed in the project recently.
 */
export async function homeCommand(_args: string[], ctx?: JiraContext): Promise<string> {
  const login = await jiraExec(["me"], ctx).then(
    (stdout) => stdout.trim(),
    (error: unknown) => {
      // Auth and config problems must surface, not be swallowed by the dashboard.
      throw error;
    },
  );

  const [mine, recent] = await Promise.all([
    safeIssues(
      [
        "issue",
        "list",
        "--assignee",
        login,
        "--status",
        "~Done",
        "--order-by",
        "updated",
        "--paginate",
        `0:${HOME_LIMIT}`,
        "--raw",
      ],
      ctx,
    ),
    safeIssues(
      [
        "issue",
        "list",
        "--updated",
        "-7d",
        "--order-by",
        "updated",
        "--paginate",
        `0:${HOME_LIMIT}`,
        "--raw",
      ],
      ctx,
    ),
  ]);

  const blocks = [encode({ user: login, ...(ctx?.project ? { project: ctx.project } : {}) })];
  blocks.push(
    mine.length ? renderList("assigned_to_me", mine, homeSchema) : "assigned_to_me: none",
  );
  blocks.push(
    recent.length
      ? renderList("updated_last_7d", recent, homeSchema)
      : "updated_last_7d: none",
  );
  blocks.push(renderHelp(getSuggestions({ domain: "home", action: "home" })));

  return renderOutput(blocks);
}

export const SETUP_HELP = `usage: jira-axi setup hooks
Install or repair agent SessionStart hooks that feed ambient Jira context into
Claude Code, Codex, and OpenCode sessions.

examples:
  jira-axi setup hooks`;

export async function setupCommand(args: string[]): Promise<string> {
  if (args[0] === "--help") return SETUP_HELP;
  if (args.length !== 1 || args[0] !== "hooks") {
    throw new AxiError("Unknown setup action", "VALIDATION_ERROR", [
      "Run `jira-axi setup hooks`",
    ]);
  }
  installSessionStartHooks();
  return renderOutput([
    encode({
      hooks: { status: "installed", integrations: "Claude Code, Codex, OpenCode" },
    }),
    renderHelp(["Restart your agent session to receive jira-axi ambient context"]),
  ]);
}
