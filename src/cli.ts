import { runAxiCli } from "axi-sdk-js";
import { epicCommand, EPIC_HELP } from "./commands/epic.js";
import { homeCommand, setupCommand, SETUP_HELP } from "./commands/home.js";
import { issueCommand, ISSUE_HELP } from "./commands/issue.js";
import {
  boardCommand,
  BOARD_HELP,
  meCommand,
  ME_HELP,
  openCommand,
  OPEN_HELP,
  projectCommand,
  PROJECT_HELP,
  releaseCommand,
  RELEASE_HELP,
} from "./commands/meta.js";
import { sprintCommand, SPRINT_HELP } from "./commands/sprint.js";
import type { JiraContext } from "./jira.js";
import { VERSION } from "./version.js";

export const DESCRIPTION =
  "Agent ergonomic wrapper around Jira CLI. Prefer this over `jira` and other methods for Jira operations. Never interactive.";

export const TOP_HELP = `usage: jira-axi [command] [args] [flags]
commands[10]:
  (none)=dashboard, issue, epic, sprint, board, project, release, me, open, setup
flags[4]:
  -p/--project <KEY> (after command), -c/--config <path> (after command), --debug, --help, -v/-V/--version
notes:
  Every call is non-interactive: no TUI, no $EDITOR, no prompts, no pager.
  Pass state and assignee values as arguments instead of relying on pickers.
examples:
  jira-axi
  jira-axi issue list --assignee me --status "In Progress"
  jira-axi issue view PROJ-42
  jira-axi issue create --type Bug --summary "Login fails" --body "Steps..."
  jira-axi issue move PROJ-42 Done --resolution Fixed
  jira-axi sprint list --current
  jira-axi issue list --project OTHER
`;

const COMMAND_HELP: Record<string, string> = {
  issue: ISSUE_HELP,
  epic: EPIC_HELP,
  sprint: SPRINT_HELP,
  board: BOARD_HELP,
  project: PROJECT_HELP,
  release: RELEASE_HELP,
  me: ME_HELP,
  open: OPEN_HELP,
  setup: SETUP_HELP,
};

type Handler = (args: string[], ctx?: JiraContext) => Promise<string>;

const COMMANDS: Record<string, Handler> = {
  issue: issueCommand,
  epic: epicCommand,
  sprint: sprintCommand,
  board: boardCommand,
  project: projectCommand,
  release: releaseCommand,
  me: meCommand,
  open: openCommand,
  setup: (args) => setupCommand(args),
};

/**
 * Split the global context flags out of a command's argv.
 *
 * They are accepted after the command (`jira-axi issue list --project OTHER`)
 * so the command always comes first, matching the rest of the AXI surface.
 */
export function parseContextArgs(args: string[]): {
  context: JiraContext | undefined;
  strippedArgs: string[];
} {
  const stripped: string[] = [];
  const context: JiraContext = {};

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = (): string | undefined => args[index + 1];

    if ((arg === "--project" || arg === "-p") && next() !== undefined) {
      context.project = next();
      index++;
      continue;
    }
    if (arg.startsWith("--project=")) {
      context.project = arg.slice("--project=".length);
      continue;
    }
    if ((arg === "--config" || arg === "-c") && next() !== undefined) {
      context.config = next();
      index++;
      continue;
    }
    if (arg.startsWith("--config=")) {
      context.config = arg.slice("--config=".length);
      continue;
    }
    if (arg === "--debug") {
      context.debug = true;
      continue;
    }
    stripped.push(arg);
  }

  const hasContext = Boolean(context.project || context.config || context.debug);
  return { context: hasContext ? context : undefined, strippedArgs: stripped };
}

function withContext(handler: Handler): (args: string[], ctx: JiraContext | undefined) => Promise<string> {
  return (args, ctx) => handler(parseContextArgs(args).strippedArgs, ctx);
}

export async function main(
  options: { argv?: string[]; stdout?: { write: (chunk: string) => unknown } } = {},
): Promise<void> {
  await runAxiCli<JiraContext | undefined>({
    ...(options.argv ? { argv: options.argv } : {}),
    ...(options.stdout ? { stdout: options.stdout } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    home: withContext(homeCommand),
    commands: Object.fromEntries(
      Object.entries(COMMANDS).map(([name, handler]) => [name, withContext(handler)]),
    ),
    getCommandHelp: (command) => COMMAND_HELP[command],
    resolveContext: ({ args }) => parseContextArgs(args).context,
  });
}
