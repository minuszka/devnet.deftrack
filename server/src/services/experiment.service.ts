import { QuorumRound } from '../models/QuorumRound.js';
import { MasternodeEvent } from '../models/MasternodeEvent.js';
import { Block } from '../models/Block.js';
import { Transaction } from '../models/Transaction.js';
import { stakingHealth, type BlockSample } from '../domain/stakingHealth.js';
import { MasternodeState } from '../models/MasternodeState.js';
import { HostStatus } from '../models/HostStatus.js';
import { roundStats } from '../domain/roundStats.js';
import type {
  ExperimentOutcome,
  ExperimentRunDocument,
  ProfileOutcome,
} from '../models/ExperimentRun.js';

/**
 * What an experiment found, computed from the underlying observations.
 *
 * Deliberately derived rather than accumulated as the run proceeds: a counter
 * incremented live cannot be corrected, and a bug in it silently rewrites the
 * conclusion. Recomputing from rounds, events and blocks means a later fix
 * changes the answer without touching the evidence.
 */
export async function computeOutcome(
  run: Pick<ExperimentRunDocument, 'startHeight' | 'endHeight'>,
  tipHeight: number
): Promise<ExperimentOutcome> {
  const from = run.startHeight;
  const to = run.endHeight ?? tipHeight;
  const heightRange = { $gte: from, $lte: to };

  const [rounds, events, blocks, coinstakes, chainLocked] = await Promise.all([
    // Every tracked profile, not just the one the run was opened against. A
    // run that watched only its own profile reported no rounds at all while
    // three of another type had already decided inside its window.
    QuorumRound.find({ expectedHeight: heightRange })
      .sort({ expectedHeight: 1 })
      .select('llmqName dkgInterval status healthRatio invalidMembers')
      .lean(),
    MasternodeEvent.find({ height: heightRange }).select('type proTxHash').lean(),
    Block.find({ height: heightRange, isProofOfStake: true }).select('height time').lean(),
    Transaction.find({ isCoinstake: true, height: heightRange }).select('height vout').lean(),
    Block.countDocuments({ height: heightRange, hasChainLock: true }),
  ]);

  // Per profile first: the schedules are interleaved, so a streak or a median
  // taken across all of them at once describes no quorum type that exists.
  const byName = new Map<string, typeof rounds>();
  for (const r of rounds) {
    const list = byName.get(r.llmqName) ?? [];
    list.push(r);
    byName.set(r.llmqName, list);
  }

  const byProfile: ProfileOutcome[] = [...byName.entries()]
    .map(([llmqName, list]) => ({
      llmqName,
      dkgInterval: list[0]?.dkgInterval ?? 0,
      ...roundStats(list),
    }))
    .sort((a, b) => a.dkgInterval - b.dkgInterval);

  const overall = roundStats(rounds);
  // The run-wide streak is the worst any single profile reached, never a count
  // over the interleaved sequence.
  const longest = byProfile.reduce((max, p) => Math.max(max, p.longestFailureStreak), 0);

  const punished = new Set<string>();
  for (const r of rounds) for (const p of r.invalidMembers) punished.add(p);
  for (const e of events) if (e.type === 'banned' || e.type === 'penalty_up') punished.add(e.proTxHash);

  const payeeByHeight = new Map<number, string>();
  for (const tx of coinstakes) {
    for (const out of tx.vout) {
      if (typeof out.scriptHex === 'string' && out.scriptHex.length > 0 && Number(out.valueSat) > 0) {
        payeeByHeight.set(tx.height, out.scriptHex);
        break;
      }
    }
  }
  const samples: BlockSample[] = blocks.map((b) => ({
    height: b.height,
    time: b.time,
    payee: payeeByHeight.get(b.height) ?? null,
  }));
  const staking = stakingHealth(samples);

  return {
    rounds: overall.rounds,
    // Pending rounds are excluded rather than counted as failures.
    formationRate: overall.formationRate,
    medianHealthRatio: overall.medianHealthRatio,
    worstHealthRatio: overall.worstHealthRatio,
    longestFailureStreak: longest,
    byProfile,

    banEvents: events.filter((e) => e.type === 'banned').length,
    revivalEvents: events.filter((e) => e.type === 'revived').length,
    penaltyIncreases: events.filter((e) => e.type === 'penalty_up').length,
    masternodesPunished: punished.size,

    blocks: blocks.length,
    medianBlockIntervalSec: staking.medianIntervalSec,
    distinctStakers: staking.distinctStakers,

    chainLockedBlocks: chainLocked,
    // Coverage over the run's own blocks only. Counting an era in which a lock
    // was impossible would report a failure that never happened.
    chainLockCoverage: blocks.length > 0 ? chainLocked / blocks.length : null,
  };
}

/** Blocks looked at when asking who is producing them. */
const STAKER_WINDOW = 200;

export interface Participants {
  masternodes: number;
  hosts: number;
  /**
   * Machines producing blocks, not payout keys.
   *
   * A coinstake pays to the key of the output it spent, so one host staking
   * five outputs shows up as five producers. Counting keys here would have
   * recorded 18 for a network of 9 machines, and a participant count that
   * inflates itself is worse than none.
   */
  stakers: number;
}

/** The network as it stands right now, on the same terms a run declares it. */
export async function currentParticipants(tipHeight: number): Promise<Participants> {
  const [masternodes, statuses, scripts] = await Promise.all([
    MasternodeState.find({ active: { $ne: false } }).select('hostIp').lean(),
    HostStatus.find().select('host stakeScripts').lean(),
    Transaction.distinct('vout.scriptHex', {
      isCoinstake: true,
      height: { $gt: tipHeight - STAKER_WINDOW },
    }),
  ]);

  const owners = new Map<string, string>();
  for (const h of statuses) {
    for (const script of h.stakeScripts ?? []) owners.set(script.toLowerCase(), h.host);
  }

  const producing = scripts.filter((s): s is string => typeof s === 'string' && s.length > 0);
  const machines = new Set<string>();
  let unattributed = 0;
  for (const script of producing) {
    const host = owners.get(script.toLowerCase());
    if (host === undefined) unattributed++;
    else machines.add(host);
  }

  const hosts = new Set(masternodes.map((m) => m.hostIp).filter((h): h is string => Boolean(h)));

  return {
    masternodes: masternodes.length,
    hosts: hosts.size,
    // Unattributed scripts are counted as one producer each: they are real
    // producers whose machine is unknown, and dropping them would understate
    // the count as badly as counting keys overstates it.
    stakers: machines.size + unattributed,
  };
}

export interface OutcomeDelta {
  formationRate: number | null;
  medianHealthRatio: number | null;
  masternodesPunished: number;
  medianBlockIntervalSec: number | null;
  chainLockCoverage: number | null;
}

/** Run minus baseline, field by field. Null where either side has no value. */
export function compareOutcomes(run: ExperimentOutcome, baseline: ExperimentOutcome): OutcomeDelta {
  const diff = (a: number | null, b: number | null): number | null =>
    a === null || b === null ? null : a - b;

  return {
    formationRate: diff(run.formationRate, baseline.formationRate),
    medianHealthRatio: diff(run.medianHealthRatio, baseline.medianHealthRatio),
    masternodesPunished: run.masternodesPunished - baseline.masternodesPunished,
    medianBlockIntervalSec: diff(run.medianBlockIntervalSec, baseline.medianBlockIntervalSec),
    chainLockCoverage: diff(run.chainLockCoverage, baseline.chainLockCoverage),
  };
}
