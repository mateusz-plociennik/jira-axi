import { encode } from "@toon-format/toon";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export type FieldDef =
  | { type: "field"; key: string; as?: string }
  | { type: "pluck"; key: string; subkey: string; as?: string }
  | { type: "joinArray"; key: string; subkey?: string; as?: string; empty?: string }
  | { type: "relativeTime"; key: string; as?: string }
  | { type: "custom"; as: string; fn: (item: Row) => unknown };

export function field(key: string, as?: string): FieldDef {
  return { type: "field", key, as };
}

export function pluck(key: string, subkey: string, as?: string): FieldDef {
  return { type: "pluck", key, subkey, as };
}

export function joinArray(
  key: string,
  subkey?: string,
  as?: string,
  empty = "none",
): FieldDef {
  return { type: "joinArray", key, subkey, as, empty };
}

export function relativeTime(key: string, as?: string): FieldDef {
  return { type: "relativeTime", key, as };
}

export function custom(as: string, fn: (item: Row) => unknown): FieldDef {
  return { type: "custom", as, fn };
}

function outputKeyOf(def: FieldDef): string {
  return def.as ?? ("key" in def ? def.key : def.as);
}

export function extract(item: Row, schema: FieldDef[]): Row {
  const result: Row = {};
  for (const def of schema) {
    const key = outputKeyOf(def);
    switch (def.type) {
      case "field":
        result[key] = item[def.key] ?? null;
        break;
      case "pluck":
        result[key] = item[def.key]?.[def.subkey] ?? null;
        break;
      case "joinArray": {
        const arr = item[def.key];
        if (Array.isArray(arr) && arr.length > 0) {
          result[key] = arr
            .map((entry) =>
              typeof entry === "string" ? entry : def.subkey ? entry?.[def.subkey] : entry,
            )
            .filter((entry) => entry !== undefined && entry !== null && entry !== "")
            .join(",");
          if (result[key] === "") result[key] = def.empty ?? "none";
        } else {
          result[key] = def.empty ?? "none";
        }
        break;
      }
      case "relativeTime":
        result[key] = formatRelativeTime(item[def.key]);
        break;
      case "custom":
        result[key] = def.fn(item);
        break;
    }
  }
  return result;
}

/** Render a labeled list of items as TOON. */
export function renderList(label: string, items: Row[], schema: FieldDef[]): string {
  return encode({ [label]: items.map((item) => extract(item, schema)) });
}

/** Render a single labeled detail object as TOON. */
export function renderDetail(label: string, item: Row, schema: FieldDef[]): string {
  return encode({ [label]: extract(item, schema) });
}

/** Render help suggestions (manual formatting — encode() inlines primitive arrays). */
export function renderHelp(lines: string[]): string {
  if (lines.length === 0) return "";
  const indented = lines.map((line) => `  ${line}`).join("\n");
  return `help[${lines.length}]:\n${indented}`;
}

/** Render an error in TOON format. */
export function renderError(
  message: string,
  code: string,
  suggestions: string[] = [],
): string {
  const blocks = [encode({ error: message, code })];
  if (suggestions.length > 0) blocks.push(renderHelp(suggestions));
  return blocks.join("\n");
}

/** Combine multiple TOON blocks into a single output string. */
export function renderOutput(blocks: string[]): string {
  return blocks.filter(Boolean).join("\n");
}

export { encode };

export function formatRelativeTime(iso: string | undefined | null): string {
  if (!iso) return "unknown";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 0) return "in the future";
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMon = Math.floor(diffDay / 30);
  if (diffMon < 12) return `${diffMon}mo ago`;
  return `${Math.floor(diffMon / 12)}y ago`;
}
