# Smoke test against real jira-cli

Unit tests mock `jira`. This checklist verifies jira-axi against a real jira-cli and Jira instance. Results from one environment don't carry over to other deployment types (Cloud vs Server/Data Center) or other jira-cli versions.

No minimum jira-cli version is claimed. The table below lists only what has been tested.

## Tested environments

| Date       | jira-axi       | jira-cli              | Jira deployment                          | Scope                                    |
| ---------- | -------------- | --------------------- | ---------------------------------------- | ---------------------------------------- |
| 2026-09-26 | main @ e41cd97 | 1.7.0 (Homebrew, darwin/arm64) | Server/Data Center (`installation: Local`, `auth_type: basic`) | Read-only commands + static flag check. Mutations not run. |

Cloud has not been tested.

## Prerequisites

- Node 20+, then `npm ci && npm run build && alias jira-axi="node $PWD/dist/bin/jira-axi.js"`
- `jira` installed. Record `jira version` and the `installation`/`auth_type` values from `~/.config/.jira/.config.yml`
- `jira init` already run by a human, with `JIRA_API_TOKEN` exported. Never paste the token into logs, issues, or PRs.
- For mutations only: a **disposable** project (or a sandbox board and sprint) that a human has explicitly approved. Never point sprint close or delete at active work.

Run every command with the interactive fallbacks sabotaged, so a launched editor or browser fails fast and closed stdin makes any prompt fail too:

```sh
export EDITOR=false VISUAL=false BROWSER=false JIRA_AXI_TIMEOUT_MS=60000
jira-axi <command> </dev/null
```

The pager can't be sabotaged this way: jira-axi intentionally pins `JIRA_PAGER` and `PAGER` to `cat` for the child `jira` process, so inherited values are ignored. To check the underlying jira-cli pager behavior, run `jira` directly, e.g. `PAGER=false jira issue list </dev/null`.

Pass means exit code 0, TOON output with a `help:` block (except `open`), and no hang. Expected failures must return a structured `error:` and `code:`.

## 1. Static flag check (no network)

Every flag jira-axi forwards must appear in `jira <subcommand> --help` for the installed version. Check `issue list|view|create|edit|assign|move|comment add|link|unlink|clone|delete|worklog add`, `epic list|create|add|remove`, `sprint list|add|close`, `board list`, `project list`, `release list`, `open`, and `me`.

## 2. Read-only

| # | Command | Expect | 2026-09-26 |
| - | ------- | ------ | ---------- |
| R1 | `jira-axi` | dashboard | pass |
| R2 | `jira-axi me` | `user:` | pass |
| R3 | `jira-axi issue list` | `count:` + `issues[...]` | pass |
| R4 | `jira-axi issue list --assignee me --status ~Done` | filtered list | pass |
| R5 | `jira-axi issue list --jql "created >= -30d"` | list | pass |
| R6 | `jira-axi issue list zzqqxx-no-match` | `count: 0` | pass |
| R7 | `jira-axi issue list --fields labels,reporter --limit 3` | `labels`/`reporter` columns, at most 3 rows | pass |
| R8 | `jira-axi issue list -p <KEY> --limit 3` | project forwarded | pass |
| R9 | `jira-axi issue list -c <config> --limit 3` | config forwarded | pass |
| R10 | `jira-axi issue view <ISSUE>` / `--comments 2` | `issue:` | pass |
| R11 | `jira-axi issue view <KEY>-999999999` | `code: NOT_FOUND` | pass |
| R12 | `jira-axi epic list` | epics | pass |
| R13 | `jira-axi sprint list` / `--current` | sprints / issues | pass |
| R14 | `jira-axi board list` | boards | pass |
| R15 | `jira-axi project list` | projects | pass |
| R16 | `jira-axi release list` | releases | **fail**: `NOT_FOUND` with the default project; jira-cli 1.7.0 requests `/rest/api/3/project/{projectIdOrKey}/versions`, which Server/DC doesn't serve ([#16](https://github.com/mateusz-plociennik/jira-axi/issues/16)) |
| R17 | `jira-axi open <ISSUE>` | URL printed, no browser | pass |

## 3. Mutations (disposable project only)

Not run yet. Blocked until a human approves a disposable project. Run these in order against issues created in steps M1 and M2 only, and record each result.

Create the body fixture for M2 first:

```sh
printf 'jira-axi smoke body\n' > ./tmp.md
```

| # | Command | Verify with |
| - | ------- | ----------- |
| M1 | `jira-axi issue create -p SANDBOX --type Task --summary "jira-axi smoke" --body "tmp"` → `$K` | `issue view $K` |
| M2 | `jira-axi issue create -p SANDBOX --type Task --summary "jira-axi smoke 2" --body-file ./tmp.md` → `$K2` | `issue view $K2` |
| M3 | `jira-axi issue edit $K --summary "jira-axi smoke edited" --label smoke` | `issue view $K` |
| M4 | `jira-axi issue assign $K me`, then `jira-axi issue assign $K x` | assignee changes |
| M5 | `jira-axi issue move $K "<valid state>" --comment "moved"`; also try an invalid state | invalid state lists the valid ones |
| M6 | `jira-axi issue comment add $K "smoke comment"` | `issue view $K --comments 1` |
| M7 | `jira-axi issue link $K $K2 Blocks`, then `jira-axi issue unlink $K $K2` | `issue view $K` |
| M8 | `jira-axi issue clone $K` → `$K3` | `issue view $K3` |
| M9 | `jira-axi issue worklog add $K "10m" --comment "smoke"` | worklog visible |
| M10 | `jira-axi epic create -p SANDBOX --name "smoke epic" --summary "smoke epic"` → `$E`; `epic add $E $K`; `epic remove $K` | `epic list $E` |
| M11 | `jira-axi sprint add <sandbox sprint id> $K` | `sprint list <id>` |
| M12 | `jira-axi sprint close <sandbox sprint id>`, **only** for a sprint created for this test | sprint state |
| M13 | One key per call: `jira-axi issue delete $K3`, `jira-axi issue delete $K2`, `jira-axi issue delete $K`, `jira-axi issue delete $E` (add `--cascade` to any key with subtasks) | `issue view` → `NOT_FOUND` |

Cleanup: list every key and sprint that was created, confirm step M13 removed them, and `rm ./tmp.md`.

## Fixtures

No fixtures were captured from the 2026-09-26 run. The only reachable instance holds private work data. Capture fixtures only from the disposable project, and sanitize names, emails, and URLs before committing them.
