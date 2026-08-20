import { describe, expect, it } from "vitest";
import {
  parseCount,
  positionals,
  pushRepeated,
  rejectUnknownFlags,
  takeAllFlags,
  takeBoolFlag,
  takeFlag,
} from "../src/args.js";
import { AxiError } from "../src/errors.js";

describe("takeFlag", () => {
  it("reads space and equals forms and removes them", () => {
    const args = ["list", "--status", "Done", "--limit=5"];
    expect(takeFlag(args, "--status")).toBe("Done");
    expect(takeFlag(args, "--limit")).toBe("5");
    expect(args).toEqual(["list"]);
  });

  it("supports short aliases", () => {
    const args = ["list", "-s", "Open"];
    expect(takeFlag(args, "--status", "-s")).toBe("Open");
    expect(args).toEqual(["list"]);
  });

  it("rejects a flag with a missing value instead of dropping it", () => {
    expect(() => takeFlag(["--status"], "--status")).toThrow(AxiError);
    expect(() => takeFlag(["--status="], "--status")).toThrow(AxiError);
  });
});

describe("takeAllFlags", () => {
  it("collects every occurrence", () => {
    const args = ["list", "--label", "a", "--label=b", "-l", "c"];
    expect(takeAllFlags(args, "--label", "-l")).toEqual(["a", "b", "c"]);
    expect(args).toEqual(["list"]);
  });
});

describe("takeBoolFlag", () => {
  it("detects and removes boolean flags", () => {
    const args = ["list", "--reverse"];
    expect(takeBoolFlag(args, "--reverse")).toBe(true);
    expect(takeBoolFlag(args, "--reverse")).toBe(false);
    expect(args).toEqual(["list"]);
  });
});

describe("positionals", () => {
  it("keeps order and drops flags", () => {
    expect(positionals(["view", "PROJ-1", "--full"])).toEqual(["view", "PROJ-1"]);
  });
});

describe("rejectUnknownFlags", () => {
  it("throws on leftover flags", () => {
    expect(() => rejectUnknownFlags(["--nope"], "usage")).toThrow(/Unknown flag: --nope/);
  });

  it("passes when only positionals remain", () => {
    expect(() => rejectUnknownFlags(["list", "PROJ-1"], "usage")).not.toThrow();
  });
});

describe("parseCount", () => {
  it("falls back and validates", () => {
    expect(parseCount(undefined, "--limit", 30)).toBe(30);
    expect(parseCount("5", "--limit", 30)).toBe(5);
    expect(() => parseCount("0", "--limit", 30)).toThrow(AxiError);
    expect(() => parseCount("abc", "--limit", 30)).toThrow(AxiError);
  });
});

describe("pushRepeated", () => {
  it("repeats the flag once per value", () => {
    const argv: string[] = [];
    pushRepeated(argv, "--label", ["a", "b"]);
    expect(argv).toEqual(["--label", "a", "--label", "b"]);
  });
});
