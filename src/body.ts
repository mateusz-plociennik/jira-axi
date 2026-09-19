import { readFileSync } from "node:fs";
import { AxiError } from "./errors.js";

/**
 * Resolve free text passed either inline (`--body`) or from a file
 * (`--body-file`). File-backed text is the supported path for multi-line
 * markdown, since jira-cli would otherwise open $EDITOR for it.
 */
export function resolveBody(
  body: string | undefined,
  bodyFile: string | undefined,
  usage: string,
): string | undefined {
  if (body !== undefined && bodyFile !== undefined) {
    throw new AxiError("Pass either --body or --body-file, not both", "VALIDATION_ERROR", [
      usage,
    ]);
  }
  if (bodyFile === undefined) return body;
  try {
    return readFileSync(bodyFile, "utf-8");
  } catch {
    throw new AxiError(`Could not read --body-file "${bodyFile}"`, "VALIDATION_ERROR", [
      "Write the markdown to a UTF-8 file first, then pass its path",
    ]);
  }
}
