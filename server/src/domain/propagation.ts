/**
 * How the same block or ChainLock reached different hosts.
 *
 * One node cannot tell a network problem from its own problem. Eight vantage
 * points can: if a block reaches seven hosts within 40 ms and the eighth two
 * seconds later, the eighth host is the finding — and if every host sees it
 * late, the producer is. That distinction is the whole reason this exists, and
 * it is the one a single seed node could never make.
 *
 * Pure so the arithmetic can be tested without hosts, a chain, or a clock.
 */
export interface HostSighting {
  host: string;
  /** Milliseconds since the epoch, on that host's own clock. */
  receivedAtMs: number;
  /**
   * The host's own clock offset when it measured, in milliseconds.
   *
   * Recorded rather than corrected for: subtracting it would state a precision
   * the measurement does not have. It is carried through so the result can
   * declare its own error bar.
   */
  clockOffsetMs: number | null;
  /** The host's timing resolution -- a poll interval, or 0 for an event feed. */
  resolutionMs: number;
}

export interface PropagationSpread {
  hosts: number;
  firstHost: string | null;
  lastHost: string | null;
  firstAtMs: number | null;
  /** Last sighting minus first, in milliseconds. */
  spreadMs: number | null;
  medianDelayMs: number | null;
  /** Per host, milliseconds behind the earliest sighting. */
  delays: Array<{ host: string; delayMs: number }>;
  /**
   * The largest error this comparison can carry: the worst clock offset plus
   * the coarsest resolution among the hosts involved. A spread smaller than
   * this is not a measurement of anything.
   */
  uncertaintyMs: number;
  /** True when the spread cannot be distinguished from clock and poll error. */
  withinNoise: boolean;
  /** Hosts that never reported this hash at all. */
  missingHosts: string[];
}

export function propagationSpread(
  sightings: HostSighting[],
  expectedHosts: readonly string[] = []
): PropagationSpread {
  const seen = new Set(sightings.map((s) => s.host));
  const missingHosts = expectedHosts.filter((h) => !seen.has(h)).sort();

  if (sightings.length === 0) {
    return {
      hosts: 0,
      firstHost: null,
      lastHost: null,
      firstAtMs: null,
      spreadMs: null,
      medianDelayMs: null,
      delays: [],
      uncertaintyMs: 0,
      withinNoise: true,
      missingHosts,
    };
  }

  const ordered = [...sightings].sort((a, b) => a.receivedAtMs - b.receivedAtMs);
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;

  const delays = ordered.map((s) => ({ host: s.host, delayMs: s.receivedAtMs - first.receivedAtMs }));
  const sortedDelays = delays.map((d) => d.delayMs).sort((a, b) => a - b);
  const mid = sortedDelays.length / 2;
  const medianDelayMs =
    sortedDelays.length % 2 === 1
      ? sortedDelays[(sortedDelays.length - 1) / 2]!
      : (sortedDelays[mid - 1]! + sortedDelays[mid]!) / 2;

  // Worst offset plus worst resolution: the comparison is only as sharp as its
  // blurriest participant.
  const worstOffset = Math.max(...ordered.map((s) => Math.abs(s.clockOffsetMs ?? 0)));
  const worstResolution = Math.max(...ordered.map((s) => s.resolutionMs));
  const uncertaintyMs = worstOffset + worstResolution;

  const spreadMs = last.receivedAtMs - first.receivedAtMs;

  return {
    hosts: ordered.length,
    firstHost: first.host,
    lastHost: last.host,
    firstAtMs: first.receivedAtMs,
    spreadMs,
    medianDelayMs,
    delays,
    uncertaintyMs,
    withinNoise: spreadMs <= uncertaintyMs,
    missingHosts,
  };
}

/**
 * Hosts that are consistently last, across many sightings.
 *
 * One late block is weather. The same host last on most blocks is the kind of
 * thing that once cost twenty unreachable masternodes and a fake ban wave --
 * and it is invisible from a single vantage point.
 */
export function laggards(
  spreads: PropagationSpread[],
  minSamples = 5
): Array<{ host: string; samples: number; meanDelayMs: number; lastPlaceShare: number }> {
  const totals = new Map<string, { sum: number; n: number; last: number }>();

  for (const s of spreads) {
    for (const d of s.delays) {
      const t = totals.get(d.host) ?? { sum: 0, n: 0, last: 0 };
      t.sum += d.delayMs;
      t.n += 1;
      if (d.host === s.lastHost && s.hosts > 1) t.last += 1;
      totals.set(d.host, t);
    }
  }

  return [...totals.entries()]
    .filter(([, t]) => t.n >= minSamples)
    .map(([host, t]) => ({
      host,
      samples: t.n,
      meanDelayMs: t.sum / t.n,
      lastPlaceShare: t.last / t.n,
    }))
    .sort((a, b) => b.meanDelayMs - a.meanDelayMs);
}
