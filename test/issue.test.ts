import { describe, it, expect, vi, beforeEach } from "vitest";

const { jiraExec } = vi.hoisted(() => ({
  jiraExec: vi.fn(),
}));

vi.mock("../src/jira.js", () => ({ jiraExec }));

import { issueCommand, ISSUE_HELP } from "../src/commands/issue.js";

describe("issueCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    jiraExec.mockResolvedValue("jira output");
  });

  it("returns ISSUE_HELP when called with no args", async () => {
    const result = await issueCommand([]);
    expect(result).toBe(ISSUE_HELP);
    expect(jiraExec).not.toHaveBeenCalled();
  });

  it("returns ISSUE_HELP when called with --help", async () => {
    const result = await issueCommand(["--help"]);
    expect(result).toBe(ISSUE_HELP);
    expect(jiraExec).not.toHaveBeenCalled();
  });

  it("injects --plain for list subcommand", async () => {
    await issueCommand(["list"]);
    expect(jiraExec).toHaveBeenCalledWith(
      expect.arrayContaining(["issue", "list", "--plain"]),
    );
  });

  it("does not inject --plain when --raw is already present", async () => {
    await issueCommand(["list", "--raw"]);
    const args = jiraExec.mock.calls[0]?.[0] as string[];
    expect(args).not.toContain("--plain");
    expect(args).toContain("--raw");
  });

  it("does not inject --plain when --plain is already present", async () => {
    await issueCommand(["list", "--plain"]);
    const args = jiraExec.mock.calls[0]?.[0] as string[];
    expect(args.filter((a) => a === "--plain")).toHaveLength(1);
  });

  it("injects --plain for view subcommand", async () => {
    await issueCommand(["view", "PRJ-123"]);
    expect(jiraExec).toHaveBeenCalledWith(
      expect.arrayContaining(["issue", "view", "--plain"]),
    );
  });

  it("injects --no-input for create subcommand", async () => {
    await issueCommand(["create", "-t", "Bug", "-s", "title"]);
    expect(jiraExec).toHaveBeenCalledWith(
      expect.arrayContaining(["issue", "create", "--no-input"]),
    );
  });

  it("injects --no-input for edit subcommand", async () => {
    await issueCommand(["edit", "PRJ-123"]);
    expect(jiraExec).toHaveBeenCalledWith(
      expect.arrayContaining(["issue", "edit", "--no-input"]),
    );
  });

  it("injects --no-input for assign subcommand", async () => {
    await issueCommand(["assign", "PRJ-123", "-a", "user@example.com"]);
    expect(jiraExec).toHaveBeenCalledWith(
      expect.arrayContaining(["issue", "assign", "--no-input"]),
    );
  });

  it("injects --no-input for move subcommand", async () => {
    await issueCommand(["move", "PRJ-123", "Done"]);
    expect(jiraExec).toHaveBeenCalledWith(
      expect.arrayContaining(["issue", "move", "--no-input"]),
    );
  });

  it("injects --no-input for comment subcommand", async () => {
    await issueCommand(["comment", "PRJ-123", "-b", "text"]);
    expect(jiraExec).toHaveBeenCalledWith(
      expect.arrayContaining(["issue", "comment", "--no-input"]),
    );
  });

  it("does not inject --no-input when already present", async () => {
    await issueCommand(["create", "--no-input", "-t", "Bug", "-s", "title"]);
    const args = jiraExec.mock.calls[0]?.[0] as string[];
    expect(args.filter((a) => a === "--no-input")).toHaveLength(1);
  });

  it("passes through additional flags unchanged", async () => {
    await issueCommand(["list", "-t", "Bug", "-s", "In Progress"]);
    const args = jiraExec.mock.calls[0]?.[0] as string[];
    expect(args).toContain("-t");
    expect(args).toContain("Bug");
    expect(args).toContain("-s");
    expect(args).toContain("In Progress");
  });

  it("passes --jql flag through to jira", async () => {
    await issueCommand(["list", "-q", "project = PRJ"]);
    const args = jiraExec.mock.calls[0]?.[0] as string[];
    expect(args).toContain("-q");
    expect(args).toContain("project = PRJ");
  });
});
