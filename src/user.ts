import { jiraExec, type JiraContext } from "./jira.js";

/**
 * Resolve the `me` alias to the configured Jira login.
 *
 * jira-cli itself has no `me` value for user flags — an agent that passes
 * "me" would silently filter on a user named "me" — so it is resolved here,
 * once, through `jira me`. `x` (unassigned) and `default` are jira-cli's own
 * sentinels and pass through untouched.
 */
export async function resolveUser(
  value: string | undefined,
  ctx?: JiraContext,
): Promise<string | undefined> {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.toLowerCase() !== "me" && trimmed !== "$(jira me)") return value;
  const login = (await jiraExec(["me"], ctx)).trim();
  return login;
}
