import { elapsed } from './format.js';

/**
 * How old the data on screen is, and whether the last attempt to renew it
 * worked.
 *
 * These are two different questions and the header answered neither. A failed
 * health poll was swallowed on purpose -- "the chain line is decoration" -- so
 * the counters stayed on screen unchanged, with a live dot beside them, for as
 * long as the endpoint stayed down. On a tool whose whole job is to say what
 * the network is doing, an old number presented as a current one is worse than
 * no number: the reader cannot tell the difference, and there is nothing on the
 * page that would let them.
 *
 * So: the last good data may stay, and it must say when it was good. A failure
 * since then is shown immediately. And "the request succeeded" never by itself
 * means "the network is healthy" -- that is what `status` and `behind` are for.
 */
export type FreshnessState =
  /** Nothing has been asked for yet, or the first request is still in flight. */
  | 'loading'
  /** The first request failed: there is nothing to show, and a retry is owed. */
  | 'unavailable'
  /** There is data, and the most recent attempt to renew it failed. */
  | 'failing'
  /** There is data, the last attempt worked, and it is older than two periods. */
  | 'stale'
  | 'fresh';

export interface FreshnessInput {
  /** When the last *accepted* successful response landed. */
  lastSuccessAtMs: number | null;
  lastFailureAtMs: number | null;
  failureMessage: string | null;
  nowMs: number;
  /** The poll period. Data older than twice this is stale. */
  intervalMs: number;
}

export interface Freshness {
  state: FreshnessState;
  /** Older than two poll periods. Can be true while the state is `failing`. */
  stale: boolean;
  /** ms since the last accepted success; null before the first one. */
  ageMs: number | null;
  /** The most recent failure, cleared by the next success. */
  error: string | null;
}

/** Two missed periods, not one: a single slow response is not staleness. */
const STALE_PERIODS = 2;

export function freshness(input: FreshnessInput): Freshness {
  const { lastSuccessAtMs, lastFailureAtMs, failureMessage, nowMs, intervalMs } = input;

  // A failure only counts while it is the newest thing that happened. The next
  // success clears it, which is why this is a comparison and not a flag: a
  // stale flag survives the success that should have cleared it.
  const failing =
    lastFailureAtMs !== null && (lastSuccessAtMs === null || lastFailureAtMs > lastSuccessAtMs);
  const error = failing ? failureMessage : null;

  if (lastSuccessAtMs === null) {
    return {
      state: failing ? 'unavailable' : 'loading',
      stale: false,
      ageMs: null,
      error,
    };
  }

  // Clamped: a clock stepping backwards must not read as data from the future.
  const ageMs = Math.max(0, nowMs - lastSuccessAtMs);
  const stale = ageMs > STALE_PERIODS * intervalMs;

  return {
    state: failing ? 'failing' : stale ? 'stale' : 'fresh',
    stale,
    ageMs,
    error,
  };
}

export type FreshnessTone = 'ok' | 'warn' | 'bad' | 'muted';

export interface FreshnessNote {
  text: string;
  tone: FreshnessTone;
  /** The failure, for a title attribute; never the only place it appears. */
  detail: string | null;
}

/**
 * One sentence for the header and the overview to agree on.
 *
 * `intervalMs` is named in the healthy case because "live" on its own claims
 * more than a 30-second poll delivers.
 */
export function freshnessNote(state: Freshness, intervalMs: number): FreshnessNote {
  const age = state.ageMs === null ? null : elapsed(state.ageMs);
  switch (state.state) {
    case 'loading':
      return { text: 'loading…', tone: 'muted', detail: null };
    case 'unavailable':
      return { text: 'no data — retry', tone: 'bad', detail: state.error };
    case 'failing':
      return { text: `refresh failed · last update ${age}`, tone: 'bad', detail: state.error };
    case 'stale':
      return { text: `stale · last update ${age}`, tone: 'warn', detail: null };
    case 'fresh':
      return {
        text: `live · updated ${age}, every ${Math.round(intervalMs / 1000)} s`,
        tone: 'ok',
        detail: null,
      };
  }
}

/**
 * A count the API could not measure, kept out of the arithmetic.
 *
 * The health endpoint answers `-1` for every figure whose source failed --
 * chain tip, indexed height, masternode totals, the round tallies, the staker
 * count -- and the header printed them. "mn -1" is not a small network; it is
 * no reading at all, and `num()` renders null as an em dash.
 *
 * Deliberately not a global rule about negative numbers: a delta, a margin and
 * a lag are all legitimately negative, and blanking those would hide real
 * findings. Apply this only where the field is a count.
 */
export function measuredCount(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * The mutable half: what a polling page records, so the pure function above can
 * be asked at render time.
 *
 * The timestamps are passed in rather than read from a global clock, because a
 * late answer from a superseded request must not be able to mark the page fresh
 * -- the caller decides what counts as accepted, and the caller is the one
 * holding `run.stale`.
 */
export class FreshnessTracker {
  private lastSuccessAtMs: number | null = null;
  private lastFailureAtMs: number | null = null;
  private failureMessage: string | null = null;

  succeeded(atMs: number): void {
    this.lastSuccessAtMs = atMs;
  }

  failed(message: string, atMs: number): void {
    this.lastFailureAtMs = atMs;
    this.failureMessage = message;
  }

  read(nowMs: number, intervalMs: number): Freshness {
    return freshness({
      lastSuccessAtMs: this.lastSuccessAtMs,
      lastFailureAtMs: this.lastFailureAtMs,
      failureMessage: this.failureMessage,
      nowMs,
      intervalMs,
    });
  }
}
