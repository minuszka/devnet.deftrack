/**
 * The filters a view is showing, kept in the address bar.
 *
 * Every filtered page held its state in component memory, so a reload lost it
 * and a link carried none of it. On an explorer whose whole use is looking into
 * an incident, that means the profile, the status, the window and the page a
 * person had arrived at cannot be handed to anybody else -- the URL in the
 * ticket opens a different screen from the one that found the thing.
 *
 * Three rules live here so the pages do not each invent their own.
 *
 * **Defaults are absent, not written.** A parameter equal to its default is
 * removed, so the plain path is the plain view and two people who navigated
 * differently to the same state get the same link.
 *
 * **A page is 1-based in the URL and an offset in the API.** `page=2` is what a
 * reader understands; `offset=50` is what the server takes. The conversion
 * happens once, here, rather than in three components with three chances to be
 * off by one.
 *
 * **Anything unreadable becomes the default rather than an error.** A negative
 * page, a NaN, a status nobody defines, a page past the server's offset cap:
 * each normalises, and the caller is told the URL was not canonical so it can
 * replace it. Replace, not push -- the reader did not ask for the correction,
 * and it must not cost them a press of Back.
 *
 * Parameters this spec does not name are left exactly as they were. Stripping
 * them would make this module the arbiter of the whole query string, which it
 * is not.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

/** The server refuses an offset past this; a page beyond it cannot be served. */
export const MAX_OFFSET = 100_000;

export type ParamSpec =
  /** One of a closed set; anything else is the fallback. */
  | { kind: 'enum'; values: readonly string[]; fallback: string }
  /** One of a closed set of numbers, e.g. a window size. */
  | { kind: 'choice'; values: readonly number[]; fallback: number }
  /** 1-based page number, clamped to what the server's offset cap allows. */
  | { kind: 'page'; limit: number }
  /**
   * A value whose absence is itself a state -- "not chosen yet" as distinct
   * from any particular choice. Validated by shape, because the set of valid
   * values comes from the server rather than from this file.
   */
  | { kind: 'optional'; pattern: RegExp };

export type ParamValue = string | number | null;

export interface QueryReading {
  values: Record<string, ParamValue>;
  /** The canonical search string for those values: `?a=b`, or '' when all default. */
  canonical: string;
  /**
   * The URL as given was not canonical. The caller replaces it -- a correction
   * nobody asked for is not a history entry.
   */
  needsNormalising: boolean;
}

/** The highest page the server's offset cap can serve at this page size. */
export function maxPageFor(limit: number, maxOffset = MAX_OFFSET): number {
  if (!Number.isFinite(limit) || limit < 1) return 1;
  return Math.max(1, Math.floor(maxOffset / limit) + 1);
}

export function pageToOffset(page: number, limit: number): number {
  return Math.max(0, (Math.max(1, Math.trunc(page)) - 1) * limit);
}

export function offsetToPage(offset: number, limit: number): number {
  if (limit < 1) return 1;
  return Math.max(1, Math.floor(Math.max(0, offset) / limit) + 1);
}

function defaultOf(spec: ParamSpec): ParamValue {
  switch (spec.kind) {
    case 'enum':
      return spec.fallback;
    case 'choice':
      return spec.fallback;
    case 'page':
      return 1;
    case 'optional':
      return null;
  }
}

function normalise(raw: string | null, spec: ParamSpec): ParamValue {
  switch (spec.kind) {
    case 'enum':
      return raw !== null && spec.values.includes(raw) ? raw : spec.fallback;
    case 'choice': {
      const parsed = raw === null ? Number.NaN : Number(raw);
      return spec.values.includes(parsed) ? parsed : spec.fallback;
    }
    case 'page': {
      const parsed = raw === null ? Number.NaN : Number(raw);
      if (!Number.isFinite(parsed)) return 1;
      const page = Math.trunc(parsed);
      if (page < 1) return 1;
      return Math.min(page, maxPageFor(spec.limit));
    }
    case 'optional':
      return raw !== null && spec.pattern.test(raw) ? raw : null;
  }
}

export function readQuery(search: string, spec: Record<string, ParamSpec>): QueryReading {
  const given = new URLSearchParams(search).toString();
  const params = new URLSearchParams(search);
  const values: Record<string, ParamValue> = {};

  for (const [key, paramSpec] of Object.entries(spec)) {
    const value = normalise(params.get(key), paramSpec);
    values[key] = value;
    if (value === defaultOf(paramSpec) || value === null) params.delete(key);
    else params.set(key, String(value));
  }

  const canonicalQs = params.toString();
  return {
    values,
    canonical: canonicalQs === '' ? '' : `?${canonicalQs}`,
    needsNormalising: canonicalQs !== given,
  };
}

/**
 * The search string for a state the reader has just chosen.
 *
 * Built from the current URL so parameters this spec does not own survive the
 * change, and defaults are dropped so the link is the shortest one that means
 * this.
 */
export function writeQuery(
  search: string,
  spec: Record<string, ParamSpec>,
  next: Record<string, ParamValue>
): string {
  const params = new URLSearchParams(search);
  for (const [key, paramSpec] of Object.entries(spec)) {
    const value = key in next ? next[key] : undefined;
    if (value === undefined) continue;
    if (value === defaultOf(paramSpec) || value === null) params.delete(key);
    else params.set(key, String(value));
  }
  const qs = params.toString();
  return qs === '' ? '' : `?${qs}`;
}

/**
 * The LLMQ profile parameter, named once.
 *
 * `llmq` in the URL because that is what a reader types; `llmqName` on the API
 * because that is what the route takes. The two names met in three components
 * before this, which is three places for them to drift apart.
 */
export const LLMQ_PARAM = 'llmq';

/** Every profile at once, asked for explicitly. Never the result of omission. */
export const LLMQ_ALL = 'all';

/** Profile names are lower-case identifiers; the valid set comes from the server. */
export const LLMQ_PATTERN = /^[a-z0-9_]{1,40}$/;

/**
 * What to send the API for a URL value.
 *
 * `null` -- nothing chosen -- and `all` are different states that both mean
 * "do not filter" to the server, and only one of them is something a reader
 * decided. Keeping them apart is what lets a page ask rather than aggregate.
 */
export function llmqApiName(value: ParamValue): string | undefined {
  if (typeof value !== 'string' || value === LLMQ_ALL) return undefined;
  return value;
}

/* ── binding it to a view ─────────────────────────────────────────────────── */

/**
 * Keeps one view's filters and the address bar in step.
 *
 * Deliberately the only thing on a page that reacts to a filter change: the
 * controls call `set`, `set` writes the URL and hands the new values back once,
 * and the page reloads from that one callback. A control that also reloaded by
 * itself would fetch twice for every click.
 *
 * A correction is `replace` and a choice is `push`, so Back returns to the
 * screen the reader was looking at rather than to a URL they never chose. And
 * writing history here never dispatches `popstate` -- the path has not changed,
 * so there is nothing for the shell to re-render, and dispatching it would make
 * every filter click remount the page. Only the browser's own Back and Forward
 * fire it, which is exactly when a re-read is wanted.
 */
export class QueryStateController implements ReactiveController {
  private current: Record<string, ParamValue>;

  private readonly onPop = (): void => {
    const reading = readQuery(location.search, this.spec);
    // A history entry can be non-canonical too -- a pasted link, a Back to one,
    // or an in-app navigation carrying a query nobody vetted. Correcting only
    // on connect left the bad query in the address bar for the whole visit,
    // with the page quietly showing the normalised view beneath it.
    this.normaliseUrl(reading);
    if (sameValues(reading.values, this.current)) return;
    this.current = reading.values;
    this.host.requestUpdate();
    this.onChange(this.current);
  };

  /** Replace, never push: the reader did not ask for the correction. */
  private normaliseUrl(reading: QueryReading): void {
    if (!reading.needsNormalising) return;
    history.replaceState(null, '', `${location.pathname}${reading.canonical}`);
  }

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly spec: Record<string, ParamSpec>,
    private readonly onChange: (values: Record<string, ParamValue>) => void
  ) {
    host.addController(this);
    this.current = readQuery(location.search, spec).values;
  }

  get values(): Record<string, ParamValue> {
    return this.current;
  }

  hostConnected(): void {
    window.addEventListener('popstate', this.onPop);
    // A URL that was not canonical is corrected without a history entry: the
    // reader did not ask for the correction and must not pay a Back for it.
    const reading = readQuery(location.search, this.spec);
    this.current = reading.values;
    this.normaliseUrl(reading);
  }

  hostDisconnected(): void {
    window.removeEventListener('popstate', this.onPop);
  }

  /** Apply a change the reader made. Nothing happens if it changes nothing. */
  set(next: Record<string, ParamValue>, mode: 'push' | 'replace' = 'push'): void {
    const search = writeQuery(location.search, this.spec, next);
    const values = readQuery(search, this.spec).values;
    if (sameValues(values, this.current)) return;
    this.current = values;
    const href = `${location.pathname}${search}`;
    if (mode === 'push') history.pushState(null, '', href);
    else history.replaceState(null, '', href);
    this.host.requestUpdate();
    this.onChange(values);
  }
}

function sameValues(a: Record<string, ParamValue>, b: Record<string, ParamValue>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}
