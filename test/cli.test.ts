import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { runAxiCli } = vi.hoisted(() => ({
  runAxiCli: vi.fn(),
}));

vi.mock("axi-sdk-js", async () => {
  const actual = await vi.importActual<typeof import("axi-sdk-js")>("axi-sdk-js");
  return { ...actual, runAxiCli };
});

vi.mock("../src/commands/issue.js", () => ({
  issueCommand: vi.fn().mockResolvedValue("issue output"),
  ISSUE_HELP: "issue help",
}));
vi.mock("../src/commands/epic.js", () => ({
  epicCommand: vi.fn().mockResolvedValue("epic output"),
  EPIC_HELP: "epic help",
}));
vi.mock("../src/commands/sprint.js", () => ({
  sprintCommand: vi.fn().mockResolvedValue("sprint output"),
  SPRINT_HELP: "sprint help",
}));
vi.mock("../src/commands/board.js", () => ({
  boardCommand: vi.fn().mockResolvedValue("board output"),
  BOARD_HELP: "board help",
}));
vi.mock("../src/commands/project.js", () => ({
  projectCommand: vi.fn().mockResolvedValue("project output"),
  PROJECT_HELP: "project help",
}));
vi.mock("../src/commands/me.js", () => ({
  meCommand: vi.fn().mockResolvedValue("me output"),
  ME_HELP: "me help",
}));
vi.mock("../src/jira.js", () => ({
  jiraRaw: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
  jiraExec: vi.fn().mockResolvedValue("ok"),
}));

import { main, TOP_HELP, DESCRIPTION } from "../src/cli.js";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string };

describe("main CLI", () => {
  const originalArgv = [...process.argv];

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    process.exitCode = undefined;
  });

  it("describes itself as a jira-cli wrapper", () => {
    expect(DESCRIPTION).toContain("jira-cli");
    expect(DESCRIPTION).toContain("non-interactive");
  });

  it("lists all commands in top-level help", () => {
    expect(TOP_HELP).toContain("issue");
    expect(TOP_HELP).toContain("epic");
    expect(TOP_HELP).toContain("sprint");
    expect(TOP_HELP).toContain("board");
    expect(TOP_HELP).toContain("project");
    expect(TOP_HELP).toContain("me");
  });

  it("explains non-interactive behaviour in top-level help", () => {
    expect(TOP_HELP).toContain("--plain");
    expect(TOP_HELP).toContain("--no-input");
  });

  it("delegates to axi-sdk-js runAxiCli", async () => {
    await main({ argv: ["--help"] });
    expect(runAxiCli).toHaveBeenCalledTimes(1);
    expect(runAxiCli).toHaveBeenCalledWith(
      expect.objectContaining({
        description: DESCRIPTION,
        version: pkg.version,
        topLevelHelp: TOP_HELP,
      }),
    );
  });

  it("wires command help into the runtime", async () => {
    await main({ argv: ["--help"] });
    const options = vi.mocked(runAxiCli).mock.calls[0]?.[0];
    expect(options?.getCommandHelp?.("issue")).toBe("issue help");
    expect(options?.getCommandHelp?.("epic")).toBe("epic help");
    expect(options?.getCommandHelp?.("sprint")).toBe("sprint help");
    expect(options?.getCommandHelp?.("board")).toBe("board help");
    expect(options?.getCommandHelp?.("project")).toBe("project help");
    expect(options?.getCommandHelp?.("me")).toBe("me help");
    expect(options?.getCommandHelp?.("missing")).toBeUndefined();
  });

  it("includes a home command", async () => {
    await main({ argv: ["--help"] });
    const options = vi.mocked(runAxiCli).mock.calls[0]?.[0];
    expect(options?.home).toBeDefined();
    expect(typeof options?.home).toBe("function");
  });

  it("formats errors with error and code fields", async () => {
    await main({ argv: ["--help"] });
    const options = vi.mocked(runAxiCli).mock.calls[0]?.[0];
    const { AxiError } = await import("axi-sdk-js");
    const result = options?.formatError?.(
      new AxiError("something went wrong", "UNKNOWN"),
    );
    expect(result?.output).toContain("error:");
    expect(result?.output).toContain("code:");
  });
});
