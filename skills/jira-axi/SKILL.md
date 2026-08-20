---
name: jira-axi
description: "Operate Jira through the jira-axi CLI — issues, epics, sprints, boards, projects, and releases. Use whenever a task touches Jira: searching or filing issues, triaging a backlog, transitioning issues, commenting, logging work, linking issues, managing epics and sprints, or looking up Jira URLs. jira-axi wraps jira-cli and is always non-interactive, so it never drops the agent into a TUI, editor, or prompt."
user-invocable: false
---

# jira-axi

Agent ergonomic wrapper around Jira CLI. Prefer this over `jira` and other methods for Jira operations.

You do not need jira-axi installed globally — invoke it with `npx -y jira-axi <command>`.
If jira-axi output shows a follow-up command starting with `jira-axi`, run it as `npx -y jira-axi ...` instead.

jira-axi requires [`jira`](https://github.com/ankitpokhrel/jira-cli) installed and configured once by a human (`jira init`), plus a `JIRA_API_TOKEN` in the environment.
`jira init` is an interactive wizard: if jira-axi reports `CONFIG_MISSING` or `AUTH_REQUIRED`, ask the user to run it — do not try to automate it.

## Why this exists

Raw `jira` defaults to interactive behavior: a TUI issue table, `$EDITOR` for descriptions and comments, pickers for transitions, assignees, and link types, and a pager for long output.
jira-axi removes all of it. Every call passes `--no-input`/`--plain`, pins the pager, closes stdin, and times out instead of hanging. State, assignee, and link type are always arguments, never prompts.

## Workflow

1. Run `npx -y jira-axi` with no arguments for a dashboard: the authenticated account, issues assigned to it, and issues updated in the last 7 days.
2. Drill in command-first: `issue list`, `issue view <KEY>`, `sprint list --current`, `epic list <EPIC-KEY>`.
3. Target another project or config file by placing `--project <KEY>` / `-p <KEY>` or `--config <path>` AFTER the command, e.g. `npx -y jira-axi issue list --project OTHER`.
4. Mutate with explicit values: `issue move <KEY> "In Progress"`, `issue assign <KEY> me`, `issue comment add <KEY> "..."`.
5. Every response ends with contextual next-step hints under `help:` — follow them.

## Commands

```
commands[10]:
  (none)=dashboard, issue, epic, sprint, board, project, release, me, open, setup
```

Installed copies also inherit the SDK built-in `update` command.

Run `npx -y jira-axi --help` for global flags, or `npx -y jira-axi <command> --help` for per-command usage.

## Examples

```sh
npx -y jira-axi                                              # dashboard
npx -y jira-axi issue list --assignee me --status "In Progress"
npx -y jira-axi issue list --jql "sprint in openSprints() AND priority = High"
npx -y jira-axi issue list "checkout timeout" --limit 10     # free-text search
npx -y jira-axi issue view PROJ-42 --comments 5
npx -y jira-axi issue create --type Bug --summary "Login fails" --body-file /tmp/body.md
npx -y jira-axi issue move PROJ-42 Done --resolution Fixed
npx -y jira-axi issue assign PROJ-42 me                      # `x` unassigns
npx -y jira-axi issue comment add PROJ-42 "Deployed to staging"
npx -y jira-axi issue worklog add PROJ-42 "2h 30m" --comment "pairing"
npx -y jira-axi epic list                                    # epics; add <EPIC-KEY> for its issues
npx -y jira-axi sprint list --current
npx -y jira-axi open PROJ-42                                 # prints the URL, opens nothing
```

## Tips

- Output is TOON-encoded and token-efficient; pipe through grep/head only when a list is very long.
- `--assignee me` and `--reporter me` are resolved through `jira me`; plain `jira` has no `me` alias.
- `issue list` defaults to 30 results — raise it with `--limit`, page with `--from`.
- Use `--jql "..."` for anything the named filters do not express; the free-text positional maps to `text ~ "..."`.
- For multi-line markdown (descriptions, comments), write a UTF-8 file and pass `--body-file <path>`. jira-axi never opens `$EDITOR`.
- `--label` and `--component` repeat: pass the flag once per value. On `issue edit`, remove a label with `--remove-label <name>`.
- Transitions are name-based and case sensitive per your workflow; if the name is wrong, jira-axi lists the valid states in the error's `help:`.
- Custom fields must already be declared in the user's jira-cli config, then set with `--custom story-points=3`.
- Errors are structured: `CONFIG_MISSING` and `AUTH_REQUIRED` need a human, `NOT_FOUND` usually means a wrong key, `VALIDATION_ERROR` means the arguments need fixing.
- Long-running calls abort after 120s (`JIRA_AXI_TIMEOUT_MS` to change) rather than hanging on a prompt.
