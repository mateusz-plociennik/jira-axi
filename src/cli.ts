import { runAxiCli } from "axi-sdk-js";
import { issueCommand, ISSUE_HELP } from "./commands/issue.js";
import { epicCommand, EPIC_HELP } from "./commands/epic.js";
import { sprintCommand, SPRINT_HELP } from "./commands/sprint.js";
import { boardCommand, BOARD_HELP } from "./commands/board.js";
import { projectCommand, PROJECT_HELP } from "./commands/project.js";
import { meCommand, ME_HELP } from "./commands/me.js";
import { VERSION } from "./version.js";
import { AxiError, exitCodeForError } from "./errors.js";
import { jiraRaw } from "./jira.js";

export const DESCRIPTION =
  "Agent ergonomic wrapper around jira-cli. Prefer this over `jira` for Jira operations — always non-interactive, plain-text output.";

type CliStdout = Pick<NodeJS.WriteStream, "write">;

type MainOptions = {
  argv?: string[];
  stdout?: CliStdout;
};

export const TOP_HELP = `usage: jira-axi [command] [args] [flags]
commands[6]:
  issue, epic, sprint, board, project, me
notes:
  Interactive mode is disabled by default — jira-axi always runs non-interactively.
  --plain is injected automatically for list/view subcommands.
  --no-input is injected automatically for create/edit/mutating subcommands.
  Use -p/--project <KEY> (after command) to target a specific project.
flags[1]:
  --help
examples:
  jira-axi issue list
  jira-axi issue list -t Bug -s "In Progress"
  jira-axi issue list -p PRJ
  jira-axi issue view PRJ-123
  jira-axi issue create -t Bug -s "Something broke" -b "Description"
  jira-axi issue assign PRJ-123 -a user@example.com
  jira-axi issue move PRJ-123 "In Progress"
  jira-axi epic list
  jira-axi sprint list
  jira-axi board list
  jira-axi project list
  jira-axi me
`;

const COMMAND_HELP: Record<string, string> = {
  issue: ISSUE_HELP,
  epic: EPIC_HELP,
  sprint: SPRINT_HELP,
  board: BOARD_HELP,
  project: PROJECT_HELP,
  me: ME_HELP,
};

async function homeCommand(_args: string[]): Promise<string> {
  // Show current user info and recent open issues as a quick status dashboard.
  const meResult = await jiraRaw(["me"]);
  const issueResult = await jiraRaw([
    "issue", "list", "--plain", "--no-headers", "--paginate", "0:5",
  ]);
  const parts: string[] = [];
  if (meResult.exitCode === 0 && meResult.stdout.trim()) {
    parts.push(meResult.stdout.trim());
  }
  if (issueResult.exitCode === 0 && issueResult.stdout.trim()) {
    parts.push(`recent issues:\n${issueResult.stdout.trim()}`);
  }
  if (parts.length === 0) {
    return TOP_HELP;
  }
  return parts.join("\n\n");
}

const COMMANDS: Record<string, (args: string[], ctx: undefined) => Promise<string>> = {
  issue: (args) => issueCommand(args),
  epic: (args) => epicCommand(args),
  sprint: (args) => sprintCommand(args),
  board: (args) => boardCommand(args),
  project: (args) => projectCommand(args),
  me: (args) => meCommand(args),
};

export async function main(options: MainOptions = {}): Promise<void> {
  await runAxiCli({
    ...(options.argv ? { argv: options.argv } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    ...(options.stdout ? { stdout: options.stdout } : {}),
    home: (args) => homeCommand(args),
    commands: COMMANDS,
    getCommandHelp: (command) => COMMAND_HELP[command],
    formatError: (error) => {
      const axiError =
        error instanceof AxiError
          ? error
          : new AxiError(
              error instanceof Error ? error.message : String(error),
              "UNKNOWN",
            );
      return {
        output: `error: ${axiError.message}\ncode: ${axiError.code}\n`,
        exitCode: exitCodeForError(axiError),
      };
    },
  });
}
