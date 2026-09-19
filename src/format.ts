/**
 * Shared count phrasing so every list command reads the same way:
 *   count: N
 *   count: N (showing first N — pass --limit for more)
 */
export function formatCountLine(options: { count: number; limit?: number }): string {
  const { count, limit } = options;
  if (limit !== undefined && count >= limit && count > 0) {
    return `count: ${count} (showing first ${limit} — raise with --limit)`;
  }
  return `count: ${count}`;
}
