import { jiraExec } from "../jira.js";

export const ME_HELP = `usage: jira-axi me
Shows information about the currently logged-in user.
examples:
  jira-axi me`;

export async function meCommand(_args: string[]): Promise<string> {
  return jiraExec(["me"]);
}
