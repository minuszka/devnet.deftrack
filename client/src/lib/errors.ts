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

/**
 * What a list says when it has never loaded and the last attempt failed.
 *
 * Not "no rows": the page does not know that. Several pages printed their
 * empty-state sentence -- "No bans recorded", "0 indexed" -- beside a red error
 * banner, so a failed request read as a record with nothing in it. Found by the
 * day-20 regression sweep.
 */
export const COULD_NOT_LOAD = 'Could not be loaded, so what exists is unknown.';

/** The message an error surface should carry. Thirteen pages inlined this. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
