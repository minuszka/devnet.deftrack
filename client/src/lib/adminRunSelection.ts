/**
 * Which run the private dashboard is looking at, and where that decision lives.
 *
 * It used to live in one component's memory, which meant a reload lost it and
 * the operator lost the Abort button for the run that was still going. It also
 * meant the dashboard's own refresh could move it: every poll recomputed the
 * selection as "the first active run, or whatever was selected", so choosing
 * run B and waiting thirty seconds silently moved the panel to run A.
 *
 * The rule, stated once and tested here rather than spread across two
 * components:
 *
 *   1. an explicit, well-formed `?run=` in the URL wins -- it is what a
 *      reload, a pasted link and a second tab all carry;
 *   2. otherwise whatever is already selected stays selected;
 *   3. otherwise, and only then, an active run may be adopted.
 *
 * A malformed or unknown key is an error to show, never a reason to quietly
 * control a different run.
 */

/** The shape the server mints: `sim_` and 32 lowercase hex digits. */
const RUN_KEY = /^sim_[0-9a-f]{32}$/;

export function isRunKey(value: string | null | undefined): value is string {
  return typeof value === 'string' && RUN_KEY.test(value);
}

export type SelectionSource =
  /** Asked for by the URL: the strongest claim, and the one a reload carries. */
  | 'url'
  /** Already on screen; a refresh must not move it. */
  | 'held'
  /** Nothing was asked for, so the live slot is offered. */
  | 'active'
  | 'none';

export interface SelectionDecision {
  runKey: string | null;
  source: SelectionSource;
  /**
   * Set when the URL carried something that is not a run key. The dashboard
   * says so instead of falling through to another run.
   */
  malformedRunKey: string | null;
}

export interface SelectionInput {
  /** The raw `?run=` value, exactly as it appeared. */
  urlRunKey: string | null;
  /** What is selected now, if anything. */
  heldRunKey: string | null;
  /** Non-terminal live runs, newest first as the API lists them. */
  activeRunKeys: readonly string[];
}

export function decideSelection(input: SelectionInput): SelectionDecision {
  const { urlRunKey, heldRunKey, activeRunKeys } = input;

  if (urlRunKey !== null && urlRunKey !== '') {
    if (isRunKey(urlRunKey)) return { runKey: urlRunKey, source: 'url', malformedRunKey: null };
    // Not a run key at all. Saying so is the whole point: the previous
    // behaviour would have gone on to adopt an active run, and the operator
    // would have been aborting something they never asked for.
    return { runKey: null, source: 'none', malformedRunKey: urlRunKey };
  }

  if (isRunKey(heldRunKey)) return { runKey: heldRunKey, source: 'held', malformedRunKey: null };

  const active = activeRunKeys.find(isRunKey) ?? null;
  if (active !== null) return { runKey: active, source: 'active', malformedRunKey: null };

  return { runKey: null, source: 'none', malformedRunKey: null };
}

/**
 * The address for a selection.
 *
 * Only the run key goes in. No session, no CSRF token, no target identity: a
 * URL is pasted into tickets and chat, and this one has to stay safe to paste.
 */
export function adminHref(runKey: string | null, base = '/admin'): string {
  return runKey === null ? base : `${base}?run=${encodeURIComponent(runKey)}`;
}

/** The `?run=` value of a URL, or null. Never throws on a malformed URL. */
export function runKeyFromSearch(search: string): string | null {
  try {
    return new URLSearchParams(search).get('run');
  } catch {
    return null;
  }
}
