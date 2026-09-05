/**
 * Two things every page did by hand, and one of them wrongly.
 *
 * A polling page aborts its in-flight request whenever a newer one starts, and
 * `fetch` reports that by rejecting -- so the page's own catch block turned a
 * deliberate cancellation into a red error bar. An abort is not a failure and
 * must never be shown as one.
 */
export function isAbortError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  return (error as { name?: unknown }).name === 'AbortError';
}

/** The message an error surface should carry. Thirteen pages inlined this. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
