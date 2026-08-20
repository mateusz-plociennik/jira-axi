import { describe, it, expect, vi, beforeEach } from "vitest";
import { mapJiraError, jiraNotInstalledError } from "../src/errors.js";

describe("mapJiraError", () => {
  it("maps missing config to AUTH_REQUIRED", () => {
    const err = mapJiraError("Missing configuration file.", 1);
    expect(err.code).toBe("AUTH_REQUIRED");
    expect(err.message).toContain("jira init");
  });

  it("maps JIRA_API_TOKEN to AUTH_REQUIRED", () => {
    const err = mapJiraError("The tool needs a JIRA_API_TOKEN to function.", 1);
    expect(err.code).toBe("AUTH_REQUIRED");
    expect(err.message).toContain("JIRA_API_TOKEN");
  });

  it("maps 401 to AUTH_REQUIRED", () => {
    const err = mapJiraError("HTTP 401 Unauthorized", 1);
    expect(err.code).toBe("AUTH_REQUIRED");
  });

  it("maps 403 to FORBIDDEN", () => {
    const err = mapJiraError("HTTP 403 Forbidden", 1);
    expect(err.code).toBe("FORBIDDEN");
  });

  it("maps not found to NOT_FOUND", () => {
    const err = mapJiraError("Issue PRJ-999 not found", 1);
    expect(err.code).toBe("NOT_FOUND");
  });

  it("falls back to UNKNOWN for unrecognized errors", () => {
    const err = mapJiraError("something unexpected happened", 1);
    expect(err.code).toBe("UNKNOWN");
  });

  it("uses the exit code in fallback message", () => {
    const err = mapJiraError("", 42);
    expect(err.message).toContain("42");
  });
});

describe("jiraNotInstalledError", () => {
  it("mentions jira-cli installation", () => {
    const err = jiraNotInstalledError();
    expect(err.message).toContain("jira-cli");
    expect(err.message).toContain("ankitpokhrel");
  });
});
