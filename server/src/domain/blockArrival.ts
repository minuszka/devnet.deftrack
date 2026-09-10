/**
 * How long after a block's own timestamp did this node hand us the block?
 *
 * The explorer's every wall-clock claim -- InstantSend lock latency, ChainLock
 * first sight, "the chain stalled" -- is made from one vantage point, the seed
 * node, and that vantage point is not always current. Measured on 2026-09-10
 * over 560 blocks on five daemons (`ops/block-arrival-lag.py`): the median gap
 * between a block's header time and the node connecting it is 2 s and p90 is
 * 6-9 s, but 0.7 % to 3.6 % of blocks land more than 120 s late, with a p99 of
 * 82-297 s and a maximum of 448 s. Two of the sixty InstantSend transactions
 * measured that day looked like a quorum failure and were a block that had not
 * arrived yet.
 *
 * So this is not a chain fact and not a health check: it is the instrument's
 * own calibration, and it belongs beside the numbers it qualifies.
 *
 * Two properties are deliberate, because both were got wrong somewhere else in
 * this project first:
 *
 *   - a block with no ZMQ sighting is *unmeasured*, never a zero. Blocks
 *     indexed before the watcher started have no first sight at all, and
 *     counting them as "arrived instantly" would put the median exactly where
 *     nobody would question it. Every share here is over `measured`.
 *   - a negative lag is kept and reported. `time` is the producing node's
 *     clock and the sighting is ours; a block seen before its own timestamp is
 *     a statement about clock skew, and clamping it at zero -- which the
 *     ChainLock latency field does, for its own reasons -- would hide the one
 *     thing that says the two clocks disagree.
 */

export interface ArrivalSample {
  height: number;
  /** The block's own header timestamp, unix seconds: the producer's clock. */
  time: number;
  /** When ZMQ handed us this block; null when it was never observed live. */
  firstSeenAt: Date | string | null;
}

export interface ArrivalPoint {
  height: number;
  time: number;
  /** Seconds; negative means the block was seen before its own timestamp. */
  lagSec: number | null;
}

export interface ArrivalSummary {
  /** Blocks in the window, measured or not. */
  blocksConsidered: number;
  /** Blocks with a live sighting -- the denominator of every share below. */
  measured: number;
  /** Blocks the watcher never saw arrive: indexed before it ran, or a gap. */
  unmeasured: number;
  firstMeasuredHeight: number | null;
  lastMeasuredHeight: number | null;
  lagSec: {
    min: number | null;
    p50: number | null;
    p90: number | null;
    p99: number | null;
    max: number | null;
  };
  /** One entry per threshold, in the order given. */
  late: Array<{ thresholdSec: number; blocks: number; share: number | null }>;
  /** The worst arrivals, worst first. */
  slowest: ArrivalPoint[];
  /** Every block in the window, oldest first, for a strip or a sparkline. */
  points: ArrivalPoint[];
}

export const DEFAULT_THRESHOLDS_SEC = [30, 120];

/** The repository's percentile convention, kept identical to the ChainLock report. */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
}

function lagOf(sample: ArrivalSample): number | null {
  if (sample.firstSeenAt === null) return null;
  const seenMs = new Date(sample.firstSeenAt).getTime();
  if (!Number.isFinite(seenMs)) return null;
  // Seconds, one decimal: the sighting is a millisecond stamp and the block
  // timestamp is a whole second, so anything finer would be false precision.
  return Math.round((seenMs / 1000 - sample.time) * 10) / 10;
}

export function summariseArrival(
  samples: ArrivalSample[],
  thresholdsSec: number[] = DEFAULT_THRESHOLDS_SEC,
  slowestCount = 10
): ArrivalSummary {
  const points: ArrivalPoint[] = samples
    .map((s) => ({ height: s.height, time: s.time, lagSec: lagOf(s) }))
    .sort((a, b) => a.height - b.height);

  const measured = points.filter((p): p is ArrivalPoint & { lagSec: number } => p.lagSec !== null);
  const sorted = measured.map((p) => p.lagSec).sort((a, b) => a - b);

  return {
    blocksConsidered: points.length,
    measured: measured.length,
    unmeasured: points.length - measured.length,
    firstMeasuredHeight: measured[0]?.height ?? null,
    lastMeasuredHeight: measured.at(-1)?.height ?? null,
    lagSec: {
      min: sorted[0] ?? null,
      p50: percentile(sorted, 0.5),
      p90: percentile(sorted, 0.9),
      p99: percentile(sorted, 0.99),
      max: sorted.at(-1) ?? null,
    },
    late: thresholdsSec.map((thresholdSec) => {
      const blocks = measured.filter((p) => p.lagSec > thresholdSec).length;
      return {
        thresholdSec,
        blocks,
        share: measured.length > 0 ? blocks / measured.length : null,
      };
    }),
    slowest: [...measured].sort((a, b) => b.lagSec - a.lagSec).slice(0, slowestCount),
    points,
  };
}
