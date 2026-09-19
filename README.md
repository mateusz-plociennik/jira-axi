<h1 align="center">jira-axi</h1>

<p align="center">
  <a href="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue?style=flat-square"><img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue?style=flat-square" /></a>
</p>

Jira CLI for agents — designed with [AXI](https://github.com/kunchenguid/axi) (Agent eXperience Interface).

Wraps [`ankitpokhrel/jira-cli`](https://github.com/ankitpokhrel/jira-cli) with token-efficient TOON output, contextual next-step suggestions, and structured error handling — and, above all, **never an interactive prompt**.

## Why

`jira` is built for humans first. Out of the box it opens a TUI issue browser, launches `$EDITOR` for issue descriptions and comments, shows pickers for transitions, assignees and link types, and pipes long output through a pager. An agent driving it through a shell either hangs or gets a screen of escape codes.

jira-axi makes every one of those paths deterministic:

| Interactive default in `jira`         | What jira-axi does                                                       |
| ------------------------------------- | ------------------------------------------------------------------------ |
| TUI table for `issue`/`epic`/`sprint` | Always `--plain`, parsed and re-emitted as TOON                           |
| `$EDITOR` for bodies and comments     | Always `--no-input`; text comes from `--body` or `--body-file`            |
| Transition / assignee / link pickers  | Values are required arguments; a wrong value lists the valid ones         |
| Pager (`less`) on several views       | Pager pinned to `cat`, terminal reported as dumb                          |
| Prompts blocking on stdin             | stdin is closed immediately, and the call is killed after a timeout       |
| Human-readable tables                 | TOON rows plus a `count:` line and `help:` next steps                     |
| Exit code 1 for everything            | Structured `error`/`code` output: `AUTH_REQUIRED`, `NOT_FOUND`, and so on |

## Requirements

- Node 20+
- [`jira`](https://github.com/ankitpokhrel/jira-cli) installed and configured once with `jira init` (an interactive wizard — a human has to run it)
- `JIRA_API_TOKEN` exported in the environment

## Quick start

```sh
npx -y jira-axi                 # dashboard — no args needed
npx -y jira-axi issue list --assignee me --status "In Progress"
```

Install the skill for agents that support [Agent Skills](https://agentskills.io):

```sh
npx skills add mateusz-plociennik/jira-axi --skill jira-axi -g
```

Or install the CLI globally:

```sh
npm install -g jira-axi
jira-axi setup hooks            # optional SessionStart hooks for Claude Code, Codex, OpenCode
```

## Usage

```sh
jira-axi                                          # dashboard: you, your issues, recent activity
jira-axi issue list                               # 30 most recent issues in the configured project
jira-axi issue list --assignee me --status ~Done  # ~ negates a status
jira-axi issue list --jql "sprint in openSprints() AND priority = High"
jira-axi issue list "checkout timeout"            # free-text search (text ~ "...")
jira-axi issue list --fields labels,reporter      # add columns to the default set
jira-axi issue view PROJ-42 --comments 5          # full detail; --full disables truncation
jira-axi issue create --type Bug --summary "Login fails" --body "Steps..."
jira-axi issue create --type Story --summary "Checkout" --body-file ./desc.md --label ux
jira-axi issue edit PROJ-42 --priority High --label ready --remove-label triage
jira-axi issue assign PROJ-42 me                  # `x` unassigns, `default` uses the default assignee
jira-axi issue move PROJ-42 Done --resolution Fixed --comment "shipped"
jira-axi issue comment add PROJ-42 "Deployed to staging"
jira-axi issue link PROJ-42 PROJ-43 Blocks
jira-axi issue worklog add PROJ-42 "2h 30m" --comment "pairing"
jira-axi issue delete PROJ-42 --cascade
jira-axi epic list                                # epics in the project
jira-axi epic list PROJ-12                        # issues inside one epic
jira-axi epic create --name "Checkout v2" --summary "Checkout v2"
jira-axi epic add PROJ-12 PROJ-42 PROJ-43
jira-axi sprint list                              # sprints on the configured board
jira-axi sprint list --current                    # issues in the active sprint
jira-axi sprint add 42 PROJ-42
jira-axi board list
jira-axi project list
jira-axi release list
jira-axi me                                       # verify authentication
jira-axi open PROJ-42                             # prints the URL, never opens a browser
```

### Commands

| Command   | Description                                                                       |
| --------- | --------------------------------------------------------------------------------- |
| `issue`   | Issues — list, view, create, edit, assign, move, comment, link, clone, delete, worklog |
| `epic`    | Epics — list, create, add, remove                                                 |
| `sprint`  | Sprints — list, add, close                                                        |
| `board`   | Boards — list                                                                     |
| `project` | Projects — list                                                                   |
| `release` | Releases (versions) — list                                                        |
| `me`      | Show the authenticated Jira account                                               |
| `open`    | Print the browse URL for an issue or project                                      |
| `setup`   | Install optional agent session hooks                                              |
| `update`  | Built-in self-update command inherited from `axi-sdk-js`                          |

### Global flags

- `--help` — show help for any command
- `-v`, `-V`, `--version` — show the installed `jira-axi` version
- `-p`/`--project <KEY>` — target another Jira project (after the command)
- `-c`/`--config <path>` — use another jira-cli config file (after the command)
- `--debug` — forward `--debug` to `jira`

### Environment

- `JIRA_API_TOKEN` — read by `jira` itself
- `JIRA_AXI_TIMEOUT_MS` — per-call timeout, default 120000

## Output

Lists are TOON tables prefixed with a `count:` line and followed by `help:` next steps:

```
count: 2
issues[2]{key,type,status,summary,assignee,priority,updated}:
  PROJ-1,Bug,In Progress,Login fails,Ann Agent,High,1d ago
  PROJ-2,Story,To Do,Checkout v2,unassigned,Medium,3h ago
help[2]:
  Run `jira-axi issue view PROJ-1` for full detail on one issue
  Filter further with --status, --assignee, --label, or --jql
```

Failures are structured rather than raw jira-cli text:

```
error: Jira API token missing — set JIRA_API_TOKEN in the environment
code: AUTH_REQUIRED
help[2]:
  Ask the user to export JIRA_API_TOKEN (Atlassian API token or PAT)
  Verify with `jira-axi me`
```

## Development

```sh
npm run build       # compile TypeScript to dist/
npm run dev         # run the CLI directly with tsx
npm test            # run tests with vitest
npm run test:watch  # watch mode
```

## License

MIT
