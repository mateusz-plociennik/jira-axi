/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

/** A jira issue flattened into the shape every jira-axi renderer consumes. */
export interface NormalizedIssue {
  key: string;
  type: string;
  status: string;
  summary: string;
  assignee: string;
  reporter: string;
  priority: string;
  resolution: string;
  labels: string[];
  components: string[];
  parent: string;
  created: string;
  updated: string;
  description: string;
  comments: { author: string; created: string; body: string }[];
  subtasks: { key: string; summary: string; status: string }[];
  links: { type: string; key: string; summary: string }[];
}

function name(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Row;
  return record["name"] ?? record["displayName"] ?? record["emailAddress"] ?? "";
}

function stringList(value: unknown, key = "name"): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry : (entry as Row)?.[key]))
    .filter((entry): entry is string => typeof entry === "string" && entry !== "");
}

/**
 * Flatten Atlassian Document Format into plain text.
 * Jira Cloud API v3 returns descriptions and comments as ADF nodes; v2 and the
 * jira-cli struct output return plain strings.
 */
export function flattenBody(body: unknown): string {
  if (body === null || body === undefined) return "";
  if (typeof body === "string") return body;
  if (Array.isArray(body)) return body.map(flattenBody).join("");
  if (typeof body !== "object") return String(body);

  const node = body as Row;
  const text = typeof node["text"] === "string" ? node["text"] : "";
  const children = Array.isArray(node["content"])
    ? node["content"].map(flattenBody).join(node["type"] === "doc" ? "\n" : "")
    : "";
  const separator =
    node["type"] === "paragraph" || node["type"] === "listItem" ? "\n" : "";
  return `${text}${children}${separator}`;
}

/**
 * Normalize an issue from either `jira issue list --raw` (jira-cli's Go struct,
 * which tags the type field `issueType`) or `jira issue view --raw` (verbatim
 * Jira REST payload, which uses `issuetype`).
 */
export function normalizeIssue(raw: Row): NormalizedIssue {
  const fields: Row = (raw?.["fields"] as Row) ?? {};
  const comments: Row[] = Array.isArray(fields["comment"]?.["comments"])
    ? fields["comment"]["comments"]
    : [];
  const subtasks: Row[] = Array.isArray(fields["subtasks"])
    ? fields["subtasks"]
    : Array.isArray(raw?.["Subtasks"])
      ? (raw["Subtasks"] as Row[])
      : [];
  const links: Row[] = Array.isArray(fields["issuelinks"])
    ? fields["issuelinks"]
    : Array.isArray(fields["issueLinks"])
      ? fields["issueLinks"]
      : [];

  return {
    key: raw?.["key"] ?? "",
    type: name(fields["issuetype"] ?? fields["issueType"]),
    status: name(fields["status"]),
    summary: fields["summary"] ?? "",
    assignee: name(fields["assignee"]) || "unassigned",
    reporter: name(fields["reporter"]),
    priority: name(fields["priority"]),
    resolution: name(fields["resolution"]) || "unresolved",
    labels: stringList(fields["labels"]),
    components: stringList(fields["components"]),
    parent: (fields["parent"] as Row)?.["key"] ?? "",
    created: fields["created"] ?? "",
    updated: fields["updated"] ?? "",
    description: flattenBody(fields["description"]).trim(),
    comments: comments.map((comment) => ({
      author: name(comment["author"]),
      created: comment["created"] ?? "",
      body: flattenBody(comment["body"]).trim(),
    })),
    subtasks: subtasks.map((subtask) => ({
      key: subtask["key"] ?? "",
      summary: (subtask["fields"] as Row)?.["summary"] ?? "",
      status: name((subtask["fields"] as Row)?.["status"]),
    })),
    links: links.flatMap((link) => {
      const related = (link["inwardIssue"] ?? link["outwardIssue"]) as Row | undefined;
      if (!related) return [];
      const direction = link["inwardIssue"] ? "inward" : "outward";
      const linkType = (link["type"] ?? link["LinkType"]) as Row | undefined;
      return [
        {
          type: linkType?.[direction] ?? name(linkType) ?? "",
          key: related["key"] ?? "",
          summary: (related["fields"] as Row)?.["summary"] ?? "",
        },
      ];
    }),
  };
}

/** Truncate long free text so a single field cannot flood an agent's context. */
export function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}…`, truncated: true };
}
