import { AxiError } from "./errors.js";

function equalsPrefix(flag: string): string {
  return `${flag}=`;
}

function requireValue(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim() === "") {
    throw new AxiError(`${flag} requires a value`, "VALIDATION_ERROR");
  }
  return value;
}

/** Read a flag value (`--flag value` or `--flag=value`) and remove it from args. */
export function takeFlag(args: string[], ...flags: string[]): string | undefined {
  for (const flag of flags) {
    const prefix = equalsPrefix(flag);
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === flag) {
        const value = requireValue(args[i + 1], flag);
        args.splice(i, 2);
        return value;
      }
      if (arg.startsWith(prefix)) {
        const value = requireValue(arg.slice(prefix.length), flag);
        args.splice(i, 1);
        return value;
      }
    }
  }
  return undefined;
}

/** Read a repeatable flag, returning every value, and remove them from args. */
export function takeAllFlags(args: string[], ...flags: string[]): string[] {
  const values: string[] = [];
  for (const flag of flags) {
    const prefix = equalsPrefix(flag);
    let i = 0;
    while (i < args.length) {
      const arg = args[i];
      if (arg === flag) {
        values.push(requireValue(args[i + 1], flag));
        args.splice(i, 2);
      } else if (arg.startsWith(prefix)) {
        values.push(requireValue(arg.slice(prefix.length), flag));
        args.splice(i, 1);
      } else {
        i++;
      }
    }
  }
  return values;
}

/** Check for a boolean flag and remove it from args. */
export function takeBoolFlag(args: string[], ...flags: string[]): boolean {
  let found = false;
  for (const flag of flags) {
    const index = args.indexOf(flag);
    if (index !== -1) {
      args.splice(index, 1);
      found = true;
    }
  }
  return found;
}

/** Remaining non-flag arguments, in order. */
export function positionals(args: string[]): string[] {
  return args.filter((arg) => !arg.startsWith("-"));
}

/** Fail on any argument the command did not consume, instead of forwarding it blindly. */
export function rejectUnknownFlags(args: string[], usage: string): void {
  const unknown = args.find((arg) => arg.startsWith("-") && arg !== "-");
  if (unknown) {
    throw new AxiError(`Unknown flag: ${unknown}`, "VALIDATION_ERROR", [usage]);
  }
}

/** Parse a positive integer flag value. */
export function parseCount(raw: string | undefined, flag: string, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AxiError(`${flag} must be a positive integer, got "${raw}"`, "VALIDATION_ERROR");
  }
  return value;
}

/** Require an issue key positional, e.g. `PROJ-42`. */
export function requireIssueKey(value: string | undefined, usage: string): string {
  if (!value) {
    throw new AxiError("Missing issue key", "VALIDATION_ERROR", [usage]);
  }
  return value;
}

/** Append a repeatable flag once per value onto a jira argv array. */
export function pushRepeated(argv: string[], flag: string, values: string[]): void {
  for (const value of values) argv.push(flag, value);
}
