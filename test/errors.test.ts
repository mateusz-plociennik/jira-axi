import { describe, expect, it } from "vitest";
import { cleanOutput, mapJiraError } from "../src/errors.js";
import { flattenBody, normalizeIssue } from "../src/fields.js";

describe("cleanOutput", () => {
  it("strips ANSI colors and jira status glyphs", () => {
    expect(cleanOutput("\u001B[31m\u2717 Error: nope\u001B[0m\n")).toBe("Error: nope");
  });
});

describe("mapJiraError", () => {
  it("maps a missing configuration file", () => {
    const error = mapJiraError("Missing configuration file.\nRun 'jira init' to configure.", 1);
    expect(error.code).toBe("CONFIG_MISSING");
    expect(error.suggestions[0]).toMatch(/jira init/);
  });

  it("maps a missing API token", () => {
    expect(mapJiraError("The tool needs a Jira API token to function.", 1).code).toBe(
      "AUTH_REQUIRED",
    );
  });

  it("maps HTTP statuses", () => {
    expect(mapJiraError("jira: Received unexpected response '401 Unauthorized'.", 1).code).toBe(
      "AUTH_REQUIRED",
    );
    expect(mapJiraError("jira: Received unexpected response '403 Forbidden'.", 1).code).toBe(
      "FORBIDDEN",
    );
    expect(mapJiraError("jira: Received unexpected response '404 Not Found'.", 1).code).toBe(
      "NOT_FOUND",
    );
  });

  it("surfaces the available states for an invalid transition", () => {
    const error = mapJiraError(
      `Error: invalid transition state "Foo"\nAvailable states for issue PROJ-1: 'In Progress', 'Done'`,
      1,
    );
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toContain('"Foo"');
    expect(error.suggestions[0]).toBe("Available states: In Progress, Done");
  });

  it("extracts the Jira error message from a 400 body", () => {
    const error = mapJiraError(
      `{"errorMessages":["Field 'customfield_1' cannot be set"]} jira: Received unexpected response '400 Bad Request'.`,
      1,
    );
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toBe("Field 'customfield_1' cannot be set");
  });

  it("falls back to the first meaningful line", () => {
    const error = mapJiraError("Error: something odd happened\nPlease try again.", 1);
    expect(error.code).toBe("UNKNOWN");
    expect(error.message).toBe("something odd happened");
  });
});

describe("normalizeIssue", () => {
  it("normalizes the Go struct shape from `issue list --raw`", () => {
    const issue = normalizeIssue({
      key: "PROJ-1",
      fields: {
        summary: "Login fails",
        issueType: { name: "Bug" },
        status: { name: "In Progress" },
        assignee: { displayName: "Ann" },
        reporter: { displayName: "Bob" },
        priority: { name: "High" },
        labels: ["backend", "urgent"],
        updated: "2026-08-19T10:00:00.000+0000",
      },
    });
    expect(issue.type).toBe("Bug");
    expect(issue.assignee).toBe("Ann");
    expect(issue.labels).toEqual(["backend", "urgent"]);
    expect(issue.resolution).toBe("unresolved");
  });

  it("normalizes the REST shape from `issue view --raw`, including links", () => {
    const issue = normalizeIssue({
      key: "PROJ-2",
      fields: {
        summary: "Checkout",
        issuetype: { name: "Story" },
        status: { name: "Done" },
        assignee: null,
        resolution: { name: "Fixed" },
        issuelinks: [
          {
            type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
            outwardIssue: { key: "PROJ-3", fields: { summary: "Payment" } },
          },
        ],
        subtasks: [{ key: "PROJ-4", fields: { summary: "Sub", status: { name: "Open" } } }],
      },
    });
    expect(issue.type).toBe("Story");
    expect(issue.assignee).toBe("unassigned");
    expect(issue.resolution).toBe("Fixed");
    expect(issue.links).toEqual([{ type: "blocks", key: "PROJ-3", summary: "Payment" }]);
    expect(issue.subtasks).toEqual([{ key: "PROJ-4", summary: "Sub", status: "Open" }]);
  });
});

describe("flattenBody", () => {
  it("passes plain strings through", () => {
    expect(flattenBody("hello")).toBe("hello");
  });

  it("flattens Atlassian Document Format", () => {
    const adf = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "first" }] },
        { type: "paragraph", content: [{ type: "text", text: "second" }] },
      ],
    };
    expect(flattenBody(adf).trim()).toBe("first\n\nsecond");
  });
});
