import { QuorumRound } from '../models/QuorumRound.js';
import { MasternodeEvent } from '../models/MasternodeEvent.js';
import { Block } from '../models/Block.js';
import { Transaction } from '../models/Transaction.js';
import { stakingHealth, type BlockSample } from '../domain/stakingHealth.js';
import type { ExperimentOutcome, ExperimentRunDocument } from '../models/ExperimentRun.js';

/**
 * What an experiment found, computed from the underlying observations.
 *
 * Deliberately derived rather than accumulated as the run proceeds: a counter
 * incremented live cannot be corrected, and a bug in it silently rewrites the
 * conclusion. Recomputing from rounds, events and blocks means a later fix
 * changes the answer without touching the evidence.
 */
export async function computeOutcome(
  run: Pick<ExperimentRunDocument, 'startHeight' | 'endHeight' | 'llmqName'>,
  tipHeight: number
): Promise<ExperimentOutcome> {
  const from = run.startHeight;
  const to = run.endHeight ?? tipHeight;
  const heightRange = { $gte: from, $lte: to };

  const [rounds, events, blocks, coinstakes, chainLocked] = await Promise.all([
    QuorumRound.find({ llmqName: run.llmqName, expectedHeight: heightRange })
      .sort({ expectedHeight: 1 })
      .select('status healthRatio invalidMembers')
      .lean(),
    MasternodeEvent.find({ height: heightRange }).select('type proTxHash').lean(),
    Block.find({ height: heightRange, isProofOfStake: true }).select('height time').lean(),
    Transaction.find({ isCoinstake: true, height: heightRange }).select('height vout').lean(),
    Block.countDocuments({ height: heightRange, hasChainLock: true }),
  ]);

  const formed = rounds.filter((r) => r.status === 'formed');
  const failed = rounds.filter((r) => r.status === 'failed');
  const pending = rounds.filter((r) => r.status === 'pending');

  const ratios = formed
    .map((r) => r.healthRatio)
    .filter((v): v is number => typeof v === 'number')
    .sort((a, b) => a - b);
  const median = ratios.length
    ? ratios.length % 2 === 1
      ? ratios[(ratios.length - 1) / 2]!
      : (ratios[ratios.length / 2 - 1]! + ratios[ratios.length / 2]!) / 2
    : null;

  let streak = 0;
  let longest = 0;
  for (const r of rounds) {
    if (r.status === 'failed') longest = Math.max(longest, ++streak);
    else if (r.status === 'formed') streak = 0;
  }

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

  const decided = formed.length + failed.length;

  return {
    rounds: { formed: formed.length, failed: failed.length, pending: pending.length },
    // Pending rounds are excluded rather than counted as failures.
    formationRate: decided > 0 ? formed.length / decided : null,
    medianHealthRatio: median,
    worstHealthRatio: ratios.length ? ratios[0]! : null,
    longestFailureStreak: longest,

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
