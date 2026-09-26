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
 * Go's tabwriter pads cells with tabs (8-column stops). With a header, cells are
 * aligned to header column positions so empty cells don't shift later columns.
 * Without one, runs of tabs collapse to a single separator.
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
  const header = headerLine === undefined ? [] : tabCells(headerLine);
  const columns = options.columns ?? header.map((cell) => cell.text.toLowerCase());
  if (header.length === 0) {
    return toRecords(
      lines.map((line) => line.split(/\t+/).map((cell) => cell.trim())),
      columns,
    );
  }

  // An empty cell is just extra tab padding, so place each cell under the
  // header column whose start position it reaches (never going backwards).
  return toRecords(
    lines.map((line) => {
      const cells: string[] = [];
      let index = -1;
      for (const cell of tabCells(line)) {
        let target = index + 1;
        while (target + 1 < header.length && header[target + 1].start <= cell.start) target++;
        cells[target] = cell.text;
        index = target;
      }
      return cells;
    }),
    columns,
  );
}

/** Split a tabwriter line into cells with their start column (8-column tab stops). */
function tabCells(line: string): { text: string; start: number }[] {
  const cells: { text: string; start: number }[] = [];
  let col = 0;
  let current: { text: string; start: number } | undefined;
  for (const char of line) {
    if (char === "\t") {
      current = undefined;
      col = (col | 7) + 1;
      continue;
    }
    if (!current) {
      current = { text: "", start: col };
      cells.push(current);
    }
    current.text += char;
    col++;
  }
  return cells
    .map((cell) => ({ text: cell.text.trim(), start: cell.start }))
    .filter((cell) => cell.text !== "");
}
