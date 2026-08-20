# jira-axi

Jira CLI for agents — designed with AXI (Agent eXperience Interface).

`jira-axi` is an AXI-compliant wrapper around [`ankitpokhrel/jira-cli`](https://github.com/ankitpokhrel/jira-cli), modeled after [`@kunchenguid/gh-axi`](https://github.com/kunchenguid/gh-axi).

## Why jira-axi?

Agents using `jira` directly have trouble because:

- **List commands launch an interactive TUI** by default — the process hangs waiting for keyboard input.
- **Create/edit/assign/move commands open interactive prompts** — the process hangs waiting for user input.

`jira-axi` fixes both problems automatically:

- `--plain` is injected for `list` and `view` subcommands (disables the TUI, outputs a plain text table).
- `--no-input` is injected for all mutating subcommands (disables interactive prompts).

## Prerequisites

1. Install [`jira-cli`](https://github.com/ankitpokhrel/jira-cli#installation).
2. Configure it: `jira init`.

## Installation

```sh
npm install -g @kunchenguid/jira-axi
# or
npx @kunchenguid/jira-axi issue list
```

## Usage

```sh
# List open issues (--plain injected automatically)
jira-axi issue list

# Filter by type and status
jira-axi issue list -t Bug -s "In Progress"

# Target a specific project
jira-axi issue list -p PRJ

# Raw JSON output
jira-axi issue list --raw

# View an issue (--plain injected automatically)
jira-axi issue view PRJ-123

# Create an issue (--no-input injected automatically)
jira-axi issue create -t Bug -s "Something broke" -b "Description here"

# Assign an issue
jira-axi issue assign PRJ-123 -a user@example.com

# Move issue to a new status
jira-axi issue move PRJ-123 "In Progress"

# Add a comment
jira-axi issue comment PRJ-123 -b "My comment"

# Epics
jira-axi epic list
jira-axi epic create -s "Big feature"

# Sprints
jira-axi sprint list

# Boards
jira-axi board list

# Projects
jira-axi project list

# Whoami
jira-axi me
```

## How it works

`jira-axi` is a thin TypeScript wrapper using [`axi-sdk-js`](https://github.com/kunchenguid/axi-sdk-js) as the CLI framework. Each command handler:

1. Receives the subcommand and any flags passed by the agent.
2. Injects the appropriate non-interactive flags (`--plain` or `--no-input`).
3. Invokes `jira` via `execFile` and returns the output.

## Development

```sh
pnpm install
pnpm build
pnpm test
```

