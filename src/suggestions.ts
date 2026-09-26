export interface SuggestionInput {
  domain: string;
  action: string;
  isEmpty?: boolean;
  key?: string;
}

/**
 * Contextual next-step hints appended under `help:` on every response, so an
 * agent can chain commands without re-reading the help text.
 */
export function getSuggestions(input: SuggestionInput): string[] {
  const { domain, action, isEmpty, key } = input;
  const ref = key ?? "<KEY>";

  if (isEmpty) {
    switch (domain) {
      case "issue":
        return [
          "No matches — widen the filters or use `jira-axi issue list --jql \"...\"`",
          "Check the active project with `jira-axi project list`",
        ];
      case "epic":
        return ["No epics found — create one with `jira-axi epic create --name ... --summary ...`"];
      case "sprint":
        return ["No sprints found — check the configured board with `jira-axi board list`"];
      default:
        return [];
    }
  }

  switch (`${domain}.${action}`) {
    case "home.home":
      return [
        "Run `jira-axi issue list --assignee me --status ~Done` for your open work",
        "Run `jira-axi sprint list --current` for the active sprint",
      ];
    case "issue.list":
      return [
        `Run \`jira-axi issue view ${ref}\` for full detail on one issue`,
        "Filter further with --status, --assignee, --label, or --jql",
      ];
    case "issue.view":
      return [
        `Run \`jira-axi issue move ${ref} "In Progress"\` to transition it`,
        `Run \`jira-axi issue comment add ${ref} "..."\` to comment`,
      ];
    case "issue.create":
      return [
        `Run \`jira-axi issue view ${ref}\` to confirm the created issue`,
        `Run \`jira-axi issue assign ${ref} me\` to take it`,
      ];
    case "issue.edit":
    case "issue.assign":
    case "issue.move":
    case "issue.comment":
      return [`Run \`jira-axi issue view ${ref}\` to verify the change`];
    case "issue.delete":
      return ["Run `jira-axi issue list` to confirm the issue is gone"];
    case "issue.link":
    case "issue.unlink":
      return [`Run \`jira-axi issue view ${ref}\` to review the remaining links`];
    case "issue.worklog":
      return [`Run \`jira-axi issue view ${ref}\` to see the logged work`];
    case "epic.list":
      return ["Run `jira-axi epic list <EPIC-KEY>` to list the issues inside an epic"];
    case "epic.create":
      return [`Run \`jira-axi epic add ${ref} <ISSUE-KEY>\` to move issues into it`];
    case "epic.add":
    case "epic.remove":
      return [`Run \`jira-axi epic list ${ref}\` to verify the epic contents`];
    case "sprint.list":
      return [
        "Run `jira-axi sprint list <SPRINT_ID>` to list the issues in one sprint",
        "Run `jira-axi sprint list --current` for the active sprint",
      ];
    case "sprint.add":
      return [`Run \`jira-axi sprint list ${ref}\` to verify the sprint contents`];
    case "board.list":
      return ["Run `jira-axi sprint list` to see sprints on the configured board"];
    case "project.list":
      return ["Target another project with `--project <KEY>` after the command"];
    default:
      return [];
  }
}
