import { cleanOutput } from "./errors.js";

/**
 * Parse RFC 4180 CSV, which is what `jira ... --plain --csv` emits.
 * jira-cli uses Go's encoding/csv writer, so quoting rules are standard.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let hasCell = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      hasCell = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
      hasCell = false;
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      hasCell = false;
    } else if (char !== "\r") {
      cell += char;
      hasCell = true;
    }
  }
  if (hasCell || cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim() !== ""));
}

function toRecords(rows: string[][], columns: string[]): Record<string, string>[] {
  return rows.map((cells) => {
    const record: Record<string, string> = {};
    columns.forEach((column, index) => {
      record[column] = (cells[index] ?? "").trim();
    });
    return record;
  });
}

/** Parse headerless CSV output into records keyed by the requested columns. */
export function parseCsvRecords(text: string, columns: string[]): Record<string, string>[] {
  return toRecords(parseCsvRows(cleanOutput(text)), columns);
}

/**
 * Parse the tab-aligned table jira-cli prints for views that have no CSV mode
 * (`sprint list`, `board list`, `project list`, `release list`).
 *
 * Go's tabwriter pads cells with additional tab characters, so runs of tabs
 * collapse to a single separator. Trailing cells that jira left empty are
 * filled in as empty strings rather than shifting later columns.
 */
export function parseTabTable(
  text: string,
  options: { columns?: string[]; hasHeader?: boolean } = {},
): Record<string, string>[] {
  const lines = cleanOutput(text)
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];

  const hasHeader = options.hasHeader ?? options.columns === undefined;
  const headerLine = hasHeader ? lines.shift() : undefined;
  const columns =
    options.columns ??
    (headerLine ?? "")
      .split(/\t+/)
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name !== "");

  return toRecords(
    lines.map((line) => line.split(/\t+/).map((cell) => cell.trim())),
    columns,
  );
}
