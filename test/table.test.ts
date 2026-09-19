import { describe, expect, it } from "vitest";
import { parseCsvRecords, parseCsvRows, parseTabTable } from "../src/table.js";

describe("parseCsvRows", () => {
  it("parses quoted cells, embedded commas, and escaped quotes", () => {
    const rows = parseCsvRows('Bug,PROJ-1,"Fix ""login"", now",Done\nStory,PROJ-2,Simple,Open\n');
    expect(rows).toEqual([
      ["Bug", "PROJ-1", 'Fix "login", now', "Done"],
      ["Story", "PROJ-2", "Simple", "Open"],
    ]);
  });

  it("keeps newlines inside quoted cells", () => {
    expect(parseCsvRows('PROJ-1,"line1\nline2"\n')).toEqual([["PROJ-1", "line1\nline2"]]);
  });
});

describe("parseCsvRecords", () => {
  it("keys cells by the requested columns and fills missing trailing cells", () => {
    const records = parseCsvRecords("Bug,PROJ-1,Done,Summary\n", [
      "type",
      "key",
      "status",
      "summary",
      "assignee",
    ]);
    expect(records).toEqual([
      { type: "Bug", key: "PROJ-1", status: "Done", summary: "Summary", assignee: "" },
    ]);
  });
});

describe("parseTabTable", () => {
  it("uses the header row when no columns are given", () => {
    const output = "ID\tNAME\tTYPE\n1\tMain board\tscrum\n2\tSupport\tkanban\n";
    expect(parseTabTable(output)).toEqual([
      { id: "1", name: "Main board", type: "scrum" },
      { id: "2", name: "Support", type: "kanban" },
    ]);
  });

  it("collapses tabwriter padding runs", () => {
    const output = "ID\t\t\tNAME\t\tTYPE\n1\t\tMain board\t\tscrum\n";
    expect(parseTabTable(output)).toEqual([{ id: "1", name: "Main board", type: "scrum" }]);
  });

  it("drops the header row when explicit columns are supplied", () => {
    const output = "42\tSprint 4\tactive\n";
    expect(parseTabTable(output, { columns: ["id", "name", "state"], hasHeader: false })).toEqual([
      { id: "42", name: "Sprint 4", state: "active" },
    ]);
  });

  it("returns an empty list for empty output", () => {
    expect(parseTabTable("\n\n")).toEqual([]);
  });
});
