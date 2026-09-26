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

  it("does not consume an adjacent option as the value", () => {
    for (const next of ["--priority", "-y", "--priority=High"]) {
      const args = ["--summary", next, "High"];
      expect(() => takeFlag(args, "--summary", "-s")).toThrow(/--summary requires a value/);
      expect(args).toEqual(["--summary", next, "High"]);
    }
    expect(() => takeFlag(["-s", "--priority"], "--summary", "-s")).toThrow(/-s requires a value/);
  });

  it("reports missing values as VALIDATION_ERROR", () => {
    try {
      takeFlag(["--summary", "--priority", "High"], "--summary");
      expect.unreachable();
    } catch (error) {
      expect((error as AxiError).code).toBe("VALIDATION_ERROR");
    }
  });

  it("keeps dash-prefixed values that are not options", () => {
    expect(takeFlag(["--updated", "-7d"], "--updated")).toBe("-7d");
    expect(takeFlag(["--summary", "-"], "--summary")).toBe("-");
    expect(takeFlag(["--summary", "-x is broken"], "--summary")).toBe("-x is broken");
    expect(takeFlag(["--summary=--literal"], "--summary")).toBe("--literal");
  });
});

describe("takeAllFlags", () => {
  it("collects every occurrence", () => {
    const args = ["list", "--label", "a", "--label=b", "-l", "c"];
    expect(takeAllFlags(args, "--label", "-l")).toEqual(["a", "b", "c"]);
    expect(args).toEqual(["list"]);
  });

  it("validates every occurrence like takeFlag", () => {
    expect(() => takeAllFlags(["--label", "a", "-l", "--status"], "--label", "-l")).toThrow(
      /-l requires a value/,
    );
    expect(() => takeAllFlags(["--label="], "--label")).toThrow(AxiError);
    expect(takeAllFlags(["--remove-label=-x"], "--remove-label")).toEqual(["-x"]);
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

  it("accepts zero when min is 0 but still rejects negative, fractional, and non-numeric", () => {
    expect(parseCount("0", "--from", 0, 0)).toBe(0);
    expect(parseCount("10", "--from", 0, 0)).toBe(10);
    for (const bad of ["-1", "1.5", "abc"]) {
      expect(() => parseCount(bad, "--from", 0, 0)).toThrow(/non-negative integer/);
    }
  });
});

describe("pushRepeated", () => {
  it("repeats the flag once per value", () => {
    const argv: string[] = [];
    pushRepeated(argv, "--label", ["a", "b"]);
    expect(argv).toEqual(["--label", "a", "--label", "b"]);
  });
});
