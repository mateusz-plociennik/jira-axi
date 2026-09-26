import { AxiError } from "axi-sdk-js";
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

const { homeCommand } = await import("../src/commands/home.js");

const RAW_ISSUE = {
  key: "PROJ-1",
  fields: {
    summary: "Login fails",
    status: { name: "In Progress" },
    priority: { name: "High" },
    updated: new Date().toISOString(),
  },
};

const isAssignedQuery = (argv: string[]) => argv.includes("--assignee");

function mockQueries(assigned: () => Promise<unknown>, recent: () => Promise<unknown>) {
  jiraJson.mockImplementation((argv) => (isAssignedQuery(argv) ? assigned() : recent()));
}

beforeEach(() => {
  jiraExec.mockReset();
  jiraJson.mockReset();
  jiraExec.mockResolvedValue("agent@example.com\n");
});

describe("home dashboard", () => {
  it("renders both query results on success", async () => {
    mockQueries(
      async () => [RAW_ISSUE],
      async () => [{ ...RAW_ISSUE, key: "PROJ-2" }],
    );
    const output = await homeCommand([]);
    expect(output).toContain("user: agent@example.com");
    expect(output).toContain("assigned_to_me");
    expect(output).toContain("PROJ-1");
    expect(output).toContain("updated_last_7d");
    expect(output).toContain("PROJ-2");
    expect(output).not.toContain(": none");
    expect(jiraJson).toHaveBeenCalledTimes(2);
    expect(jiraJson.mock.calls.find(([argv]) => isAssignedQuery(argv))?.[0]).toContain(
      "agent@example.com",
    );
  });

  it("filters open work by status category, not a status named Done", async () => {
    mockQueries(
      async () => [],
      async () => [],
    );
    const output = await homeCommand([]);
    const argv = jiraJson.mock.calls.find(([a]) => isAssignedQuery(a))?.[0] ?? [];
    expect(argv.join(" ")).toContain("--jql statusCategory != Done");
    expect(argv).not.toContain("~Done");
    expect(output).toContain(
      'Run `jira-axi issue list --assignee me --jql "statusCategory != Done"` for your open work',
    );
  });

  it("renders none for genuinely empty results", async () => {
    mockQueries(
      async () => [],
      async () => [],
    );
    const output = await homeCommand([]);
    expect(output).toContain("assigned_to_me: none");
    expect(output).toContain("updated_last_7d: none");
  });

  it("renders none when jira-cli reports No result found", async () => {
    const noResult = async () => {
      throw new AxiError("No result found for given query in project", "UNKNOWN");
    };
    mockQueries(noResult, noResult);
    const output = await homeCommand([]);
    expect(output).toContain("assigned_to_me: none");
    expect(output).toContain("updated_last_7d: none");
  });

  const failures: [string, () => Error][] = [
    ["permission error", () => new AxiError("403 Forbidden", "FORBIDDEN")],
    ["timeout", () => new AxiError("jira timed out after 30s", "TIMEOUT")],
    ["rate limit", () => new AxiError("429 Too Many Requests", "UNKNOWN")],
    ["invalid JSON", () => new AxiError("jira returned invalid JSON", "UNKNOWN")],
    ["non-Axi error", () => new Error("spawn failed")],
  ];

  for (const [name, makeError] of failures) {
    it(`propagates a ${name} from the assigned query`, async () => {
      const error = makeError();
      mockQueries(
        async () => {
          throw error;
        },
        async () => [RAW_ISSUE],
      );
      await expect(homeCommand([])).rejects.toBe(error);
    });

    it(`propagates a ${name} from the recent query`, async () => {
      const error = makeError();
      mockQueries(
        async () => [RAW_ISSUE],
        async () => {
          throw error;
        },
      );
      await expect(homeCommand([])).rejects.toBe(error);
    });
  }

  it("propagates auth/config errors from jira me without querying issues", async () => {
    const error = new AxiError("401 Unauthorized", "AUTH_REQUIRED");
    jiraExec.mockRejectedValue(error);
    await expect(homeCommand([])).rejects.toBe(error);
    expect(jiraJson).not.toHaveBeenCalled();
  });
});
