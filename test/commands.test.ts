import { beforeEach, describe, expect, it, vi } from "vitest";

const jiraExec = vi.fn<(args: string[], ctx?: unknown) => Promise<string>>();
const jiraJson = vi.fn<(args: string[], ctx?: unknown) => Promise<unknown>>();

vi.mock("../src/jira.js", () => ({
  jiraExec: (args: string[], ctx?: unknown) => jiraExec(args, ctx),
  jiraJson: (args: string[], ctx?: unknown) => jiraJson(args, ctx),
  jiraExecWithStdin: vi.fn(),
  jiraRaw: vi.fn(),
  buildArgs: (args: string[]) => args,
}));

const { issueCommand } = await import("../src/commands/issue.js");
const { epicCommand } = await import("../src/commands/epic.js");
const { sprintCommand } = await import("../src/commands/sprint.js");
const { meCommand, openCommand } = await import("../src/commands/meta.js");

const RAW_ISSUE = {
  key: "PROJ-1",
  fields: {
    summary: "Login fails",
    issueType: { name: "Bug" },
    status: { name: "In Progress" },
    assignee: { displayName: "Ann" },
    priority: { name: "High" },
    updated: new Date().toISOString(),
  },
};

beforeEach(() => {
  jiraExec.mockReset();
  jiraJson.mockReset();
});

describe("issue list", () => {
  it("maps filters onto jira flags and always requests JSON", async () => {
    jiraJson.mockResolvedValue([RAW_ISSUE]);
    const output = await issueCommand([
      "list",
      "--status",
      "In Progress",
      "--status=Blocked",
      "--label",
      "backend",
      "--limit",
      "5",
      "--jql",
      "sprint in openSprints()",
    ]);

    expect(jiraJson).toHaveBeenCalledTimes(1);
    expect(jiraJson.mock.calls[0][0]).toEqual([
      "issue",
      "list",
      "--jql",
      "sprint in openSprints()",
      "--status",
      "In Progress",
      "--status",
      "Blocked",
      "--label",
      "backend",
      "--paginate",
      "0:5",
      "--raw",
    ]);
    expect(output).toContain("count: 1");
    expect(output).toContain("PROJ-1");
  });

  it("resolves --assignee me through `jira me`", async () => {
    jiraExec.mockResolvedValue("agent@example.com\n");
    jiraJson.mockResolvedValue([]);
    await issueCommand(["list", "--assignee", "me"]);

    expect(jiraExec.mock.calls[0][0]).toEqual(["me"]);
    expect(jiraJson.mock.calls[0][0]).toContain("agent@example.com");
  });

  it("passes a free text query as a positional argument", async () => {
    jiraJson.mockResolvedValue([]);
    await issueCommand(["list", "checkout bug"]);
    const argv = jiraJson.mock.calls[0][0];
    expect(argv[argv.length - 2]).toBe("checkout bug");
  });

  it("rejects unknown flags instead of forwarding them", async () => {
    await expect(issueCommand(["list", "--bogus", "x"])).rejects.toThrow(/Unknown flag/);
    expect(jiraJson).not.toHaveBeenCalled();
  });

  it("reports an empty result set without failing", async () => {
    jiraJson.mockResolvedValue([]);
    const output = await issueCommand(["list"]);
    expect(output).toContain("count: 0");
    expect(output).toContain("issues: none");
  });
});

describe("issue view", () => {
  it("requests raw JSON with a comment budget", async () => {
    jiraJson.mockResolvedValue({
      key: "PROJ-1",
      fields: { summary: "Login fails", issuetype: { name: "Bug" }, status: { name: "Done" } },
    });
    const output = await issueCommand(["view", "PROJ-1", "--comments", "2"]);
    expect(jiraJson.mock.calls[0][0]).toEqual([
      "issue",
      "view",
      "PROJ-1",
      "--comments",
      "2",
      "--raw",
    ]);
    expect(output).toContain("key: PROJ-1");
  });

  it("truncates long descriptions unless --full is passed", async () => {
    jiraJson.mockResolvedValue({
      key: "PROJ-1",
      fields: { summary: "s", description: "x".repeat(5000) },
    });
    expect(await issueCommand(["view", "PROJ-1"])).toContain("description_truncated: true");

    jiraJson.mockResolvedValue({
      key: "PROJ-1",
      fields: { summary: "s", description: "x".repeat(5000) },
    });
    expect(await issueCommand(["view", "PROJ-1", "--full"])).not.toContain(
      "description_truncated",
    );
  });

  it("requires an issue key", async () => {
    await expect(issueCommand(["view"])).rejects.toThrow(/Missing issue key/);
  });
});

describe("issue mutations", () => {
  it("creates non-interactively and returns the new key", async () => {
    jiraJson.mockResolvedValue({ key: "PROJ-9" });
    const output = await issueCommand([
      "create",
      "--type",
      "Bug",
      "--summary",
      "Login fails",
      "--body",
      "steps",
      "--label",
      "a",
      "--label",
      "b",
    ]);
    const argv = jiraJson.mock.calls[0][0];
    expect(argv.slice(0, 4)).toEqual(["issue", "create", "--no-input", "--raw"]);
    expect(argv).toEqual(expect.arrayContaining(["--label", "a", "--label", "b"]));
    expect(output).toContain("key: PROJ-9");
  });

  it("requires --type and --summary", async () => {
    await expect(issueCommand(["create", "--summary", "x"])).rejects.toThrow(
      /--type and --summary are required/,
    );
  });

  it("edits with --no-input and supports label removal", async () => {
    jiraExec.mockResolvedValue("");
    await issueCommand(["edit", "PROJ-1", "--label", "keep", "--remove-label", "stale"]);
    expect(jiraExec.mock.calls[0][0]).toEqual([
      "issue",
      "edit",
      "PROJ-1",
      "--no-input",
      "--label",
      "keep",
      "--label",
      "-stale",
    ]);
  });

  it("assigns by positional user, resolving me", async () => {
    jiraExec.mockResolvedValueOnce("agent@example.com\n").mockResolvedValueOnce("");
    await issueCommand(["assign", "PROJ-1", "me"]);
    expect(jiraExec.mock.calls[1][0]).toEqual([
      "issue",
      "assign",
      "PROJ-1",
      "agent@example.com",
    ]);
  });

  it("refuses to move an issue without an explicit state", async () => {
    await expect(issueCommand(["move", "PROJ-1"])).rejects.toThrow(/Missing target state/);
    expect(jiraExec).not.toHaveBeenCalled();
  });

  it("moves with optional resolution and comment", async () => {
    jiraExec.mockResolvedValue("");
    await issueCommand(["move", "PROJ-1", "Done", "--resolution", "Fixed", "--comment", "ship"]);
    expect(jiraExec.mock.calls[0][0]).toEqual([
      "issue",
      "move",
      "PROJ-1",
      "Done",
      "--comment",
      "ship",
      "--resolution",
      "Fixed",
    ]);
  });

  it("adds a comment from a positional body with --no-input", async () => {
    jiraExec.mockResolvedValue("");
    await issueCommand(["comment", "add", "PROJ-1", "looks good"]);
    expect(jiraExec.mock.calls[0][0]).toEqual([
      "issue",
      "comment",
      "add",
      "PROJ-1",
      "looks good",
      "--no-input",
    ]);
  });

  it("requires a comment body", async () => {
    await expect(issueCommand(["comment", "add", "PROJ-1"])).rejects.toThrow(
      /Missing comment body/,
    );
  });

  it("logs work with --no-input", async () => {
    jiraExec.mockResolvedValue("");
    await issueCommand(["worklog", "add", "PROJ-1", "2h", "--comment", "pairing"]);
    expect(jiraExec.mock.calls[0][0]).toEqual([
      "issue",
      "worklog",
      "add",
      "PROJ-1",
      "2h",
      "--no-input",
      "--comment",
      "pairing",
    ]);
  });

  it("deletes with cascade", async () => {
    jiraExec.mockResolvedValue("");
    await issueCommand(["delete", "PROJ-1", "--cascade"]);
    expect(jiraExec.mock.calls[0][0]).toEqual(["issue", "delete", "PROJ-1", "--cascade"]);
  });

  it("links issues from positional arguments", async () => {
    jiraExec.mockResolvedValue("");
    await issueCommand(["link", "PROJ-1", "PROJ-2", "Blocks"]);
    expect(jiraExec.mock.calls[0][0]).toEqual(["issue", "link", "PROJ-1", "PROJ-2", "Blocks"]);
  });
});

describe("epic", () => {
  it("lists epics through `issue list --type Epic --raw`", async () => {
    jiraJson.mockResolvedValue([RAW_ISSUE]);
    await epicCommand(["list"]);
    const argv = jiraJson.mock.calls[0][0];
    expect(argv.slice(0, 2)).toEqual(["issue", "list"]);
    expect(argv).toEqual(expect.arrayContaining(["--type", "Epic", "--raw"]));
  });

  it("lists issues of one epic through CSV output", async () => {
    jiraExec.mockResolvedValue("Bug,PROJ-2,Done,Fix it,Ann\n");
    const output = await epicCommand(["list", "PROJ-1"]);
    expect(jiraExec.mock.calls[0][0]).toEqual([
      "epic",
      "list",
      "PROJ-1",
      "--paginate",
      "0:30",
      "--plain",
      "--csv",
      "--no-headers",
      "--columns",
      "type,key,status,summary,assignee",
    ]);
    expect(output).toContain("PROJ-2");
  });

  it("creates an epic with --no-input and parses the key from the browse URL", async () => {
    jiraExec.mockResolvedValue("Epic created\nhttps://x.atlassian.net/browse/PROJ-7\n");
    const output = await epicCommand(["create", "--name", "Checkout", "--summary", "Checkout"]);
    expect(jiraExec.mock.calls[0][0]).toEqual([
      "epic",
      "create",
      "--no-input",
      "--name",
      "Checkout",
      "--summary",
      "Checkout",
    ]);
    expect(output).toContain("key: PROJ-7");
  });
});

describe("sprint", () => {
  it("lists sprint metadata as a plain table", async () => {
    jiraExec.mockResolvedValue("42\tSprint 4\tactive\t2026-08-01\t2026-08-14\n");
    const output = await sprintCommand(["list"]);
    expect(jiraExec.mock.calls[0][0]).toEqual([
      "sprint",
      "list",
      "--paginate",
      "0:30",
      "--plain",
      "--no-headers",
      "--columns",
      "id,name,state,start,end",
    ]);
    expect(output).toContain("Sprint 4");
  });

  it("lists issues of the current sprint as CSV", async () => {
    jiraExec.mockResolvedValue("Bug,PROJ-1,Done,Fix it,Ann\n");
    await sprintCommand(["list", "--current"]);
    const argv = jiraExec.mock.calls[0][0];
    expect(argv).toEqual(expect.arrayContaining(["--current", "--csv"]));
  });
});

describe("meta commands", () => {
  it("reports the authenticated user", async () => {
    jiraExec.mockResolvedValue("agent@example.com\n");
    expect(await meCommand([])).toContain("user: agent@example.com");
  });

  it("returns a browse URL without opening a browser", async () => {
    jiraExec.mockResolvedValue("https://x.atlassian.net/browse/PROJ-1\n");
    const output = await openCommand(["PROJ-1"]);
    expect(jiraExec.mock.calls[0][0]).toEqual(["open", "PROJ-1", "--no-browser"]);
    expect(output).toContain("browse/PROJ-1");
  });
});
