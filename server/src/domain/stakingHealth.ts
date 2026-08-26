/**
 * How healthy block production is, and how concentrated it is.
 *
 * On a chain whose only producers are our own nodes, "is the chain moving" and
 * "is it moving because of one machine" are different questions, and the second
 * one is the one that decides whether a measurement is worth anything. A devnet
 * where a single wallet mints every block cannot say anything about a network.
 *
 * Pure so the arithmetic can be tested without a chain.
 */
export interface BlockSample {
  height: number;
  /** Block timestamp in seconds. */
  time: number;
  /** Output script of the coinstake payee; null when the block paid nobody. */
  payee: string | null;
}

export interface StakingHealth {
  blocks: number;
  fromHeight: number;
  toHeight: number;

  /** Seconds between consecutive blocks. */
  medianIntervalSec: number | null;
  meanIntervalSec: number | null;
  /** The worst pause in the window -- what a stall looks like in the data. */
  longestGapSec: number | null;
  /** Intervals longer than ten minutes: production faltering, not just varying. */
  stallCount: number;

  distinctStakers: number;
  /**
   * Herfindahl-Hirschman index over block share, 0..1.
   *
   * 1 means one producer mints everything; 1/n means n producers share it
   * evenly. Reported as a fraction rather than the usual 10,000-point scale so
   * it reads directly against the staker count.
   */
  hhi: number | null;
  /** 0 = every staker produced equally, approaching 1 = one takes everything. */
  gini: number | null;
  /** Share of blocks produced by the single busiest staker. */
  topStakerShare: number | null;

  stakers: Array<{ payee: string; blocks: number; share: number }>;

  /**
   * The same production grouped by machine, where the owner of a payout script
   * is known.
   *
   * This is the figure that answers the question. A coinstake pays to the key
   * of the output it spent, so one host with five staked outputs appears five
   * times above -- which reads as five independent producers and dilutes the
   * concentration index in exactly the wrong direction. Null when no ownership
   * is known, rather than silently falling back to the per-key numbers.
   */
  byHost: {
    distinctHosts: number;
    hhi: number | null;
    topHostShare: number | null;
    unattributedBlocks: number;
    hosts: Array<{ host: string; blocks: number; share: number }>;
  } | null;
}

/** Intervals above this are treated as production faltering, not variance. */
const STALL_SEC = 600;

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = sorted.length / 2;
  return sorted.length % 2 === 1
    ? sorted[(sorted.length - 1) / 2]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Payout script -> the machine that produces it. */
export type ScriptOwners = ReadonlyMap<string, string>;

export function stakingHealth(samples: BlockSample[], owners: ScriptOwners = new Map()): StakingHealth {
  // Oldest first: intervals only mean anything in chain order.
  const blocks = [...samples].sort((a, b) => a.height - b.height);

  const intervals: number[] = [];
  for (let i = 1; i < blocks.length; i++) {
    // Block timestamps are set by the staking node and can go backwards
    // slightly; a negative interval is a clock artefact, not a measurement.
    const delta = blocks[i]!.time - blocks[i - 1]!.time;
    if (delta >= 0) intervals.push(delta);
  }

  const counts = new Map<string, number>();
  for (const b of blocks) {
    if (!b.payee) continue;
    counts.set(b.payee, (counts.get(b.payee) ?? 0) + 1);
  }

  const totalPaid = [...counts.values()].reduce((a, b) => a + b, 0);
  const stakers = [...counts.entries()]
    .map(([payee, n]) => ({ payee, blocks: n, share: totalPaid > 0 ? n / totalPaid : 0 }))
    .sort((a, b) => b.blocks - a.blocks);

  const hhi = totalPaid > 0 ? stakers.reduce((sum, s) => sum + s.share * s.share, 0) : null;

  // Gini over blocks produced per staker. Only meaningful once more than one
  // staker exists: with a single producer there is no distribution to measure,
  // and reporting 0 would suggest perfect equality rather than no data.
  let gini: number | null = null;
  if (stakers.length > 1) {
    const values = stakers.map((s) => s.blocks).sort((a, b) => a - b);
    const n = values.length;
    const sum = values.reduce((a, b) => a + b, 0);
    let weighted = 0;
    for (let i = 0; i < n; i++) weighted += (i + 1) * values[i]!;
    gini = sum > 0 ? (2 * weighted) / (n * sum) - (n + 1) / n : 0;
  }

  const sortedIntervals = [...intervals].sort((a, b) => a - b);

  // Grouped by machine. Blocks whose payout script belongs to no known host are
  // counted separately rather than assigned to one, and rather than quietly
  // dropped: an unattributed producer is a gap in the map, not an absence.
  let byHost: StakingHealth['byHost'] = null;
  if (owners.size > 0 && totalPaid > 0) {
    const perHost = new Map<string, number>();
    let unattributed = 0;
    for (const s of stakers) {
      const host = owners.get(s.payee);
      if (host === undefined) {
        unattributed += s.blocks;
        continue;
      }
      perHost.set(host, (perHost.get(host) ?? 0) + s.blocks);
    }

    const attributed = [...perHost.values()].reduce((a, b) => a + b, 0);
    const hosts = [...perHost.entries()]
      .map(([host, n]) => ({ host, blocks: n, share: attributed > 0 ? n / attributed : 0 }))
      .sort((a, b) => b.blocks - a.blocks);

    byHost = {
      distinctHosts: hosts.length,
      hhi: hosts.length > 0 ? hosts.reduce((sum, h) => sum + h.share * h.share, 0) : null,
      topHostShare: hosts[0]?.share ?? null,
      unattributedBlocks: unattributed,
      hosts,
    };
  }

  return {
    blocks: blocks.length,
    fromHeight: blocks[0]?.height ?? 0,
    toHeight: blocks[blocks.length - 1]?.height ?? 0,
    medianIntervalSec: median(sortedIntervals),
    meanIntervalSec: intervals.length > 0 ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null,
    longestGapSec: sortedIntervals.length > 0 ? sortedIntervals[sortedIntervals.length - 1]! : null,
    stallCount: intervals.filter((v) => v > STALL_SEC).length,
    distinctStakers: stakers.length,
    hhi,
    gini,
    topStakerShare: stakers[0]?.share ?? null,
    stakers,
    byHost,
  };
}
