import { describe, expect, it } from 'vitest';
import { compareOutcomes } from '../services/experiment.service.js';
import type { ExperimentOutcome } from '../models/ExperimentRun.js';

const outcome = (partial: Partial<ExperimentOutcome>): ExperimentOutcome => ({
  rounds: { formed: 0, failed: 0, pending: 0, impossible: 0 },
  formationRate: null,
  medianHealthRatio: null,
  worstHealthRatio: null,
  longestFailureStreak: 0,
  banEvents: 0,
  revivalEvents: 0,
  penaltyIncreases: 0,
  masternodesPunished: 0,
  blocks: 0,
  medianBlockIntervalSec: null,
  distinctStakers: 0,
  chainLockedBlocks: 0,
  chainLockCoverage: null,
  ...partial,
});

describe('comparing a run against its baseline', () => {
  it('reports the signed difference from the baseline', () => {
    const delta = compareOutcomes(
      outcome({ formationRate: 0.6, masternodesPunished: 12 }),
      outcome({ formationRate: 0.95, masternodesPunished: 2 })
    );
    expect(delta.formationRate).toBeCloseTo(-0.35, 6);
    expect(delta.masternodesPunished).toBe(10);
  });

  it('reports the mean-interval and concentration changes, and null where a side never carried them', () => {
    const delta = compareOutcomes(
      outcome({ meanBlockIntervalSec: 161.6, topStakerShare: 0.0506, stakerHhi: 0.03, stakerGini: 0.216 }),
      outcome({ meanBlockIntervalSec: 150, topStakerShare: 0.44, stakerHhi: 0.2, stakerGini: 0.6 })
    );
    expect(delta.meanBlockIntervalSec).toBeCloseTo(11.6, 6);
    expect(delta.topStakerShare).toBeCloseTo(-0.3894, 6);
    expect(delta.stakerHhi).toBeCloseTo(-0.17, 6);
    expect(delta.stakerGini).toBeCloseTo(-0.384, 6);

    // A baseline frozen before these fields existed has no value, not zero: a
    // zero would state that concentration did not change when it was never
    // measured on that side.
    const old = compareOutcomes(outcome({ meanBlockIntervalSec: 161.6, stakerGini: 0.2 }), outcome({}));
    expect(old.meanBlockIntervalSec).toBeNull();
    expect(old.stakerGini).toBeNull();
  });

  it('compares the mainnet view where both sides carry it, and refuses where one does not', () => {
    const mainnet = (formationRate: number | null, membersPunished: number) => ({
      profiles: ['llmq_400_60', 'llmq_defcon'],
      rounds: { formed: 0, failed: 0, pending: 0, impossible: 0 },
      formationRate,
      medianHealthRatio: null,
      worstHealthRatio: null,
      longestFailureStreak: 0,
      membersPunished,
    });
    // The 2026-09-10 roll: the devnet counted three punished, every one in a
    // llmq_50_60 round; as mainnet counts it, nothing moved.
    const delta = compareOutcomes(
      outcome({ masternodesPunished: 3, mainnetRelevant: mainnet(1, 0) }),
      outcome({ masternodesPunished: 1, mainnetRelevant: mainnet(0.875, 0) })
    );
    expect(delta.masternodesPunished).toBe(2);
    expect(delta.mainnetMembersPunished).toBe(0);
    expect(delta.mainnetFormationRate).toBeCloseTo(0.125, 6);

    const old = compareOutcomes(outcome({ mainnetRelevant: mainnet(1, 0) }), outcome({}));
    expect(old.mainnetFormationRate).toBeNull();
    expect(old.mainnetMembersPunished).toBeNull();
  });

  it('refuses to compare where either side has no value', () => {
    // A baseline with no formed round has no health ratio, and subtracting from
    // nothing would state a change that was never measured.
    const delta = compareOutcomes(
      outcome({ medianHealthRatio: 0.9 }),
      outcome({ medianHealthRatio: null })
    );
    expect(delta.medianHealthRatio).toBeNull();
  });

  it('treats a zero difference as measured, not as missing', () => {
    const delta = compareOutcomes(
      outcome({ formationRate: 1, chainLockCoverage: 1 }),
      outcome({ formationRate: 1, chainLockCoverage: 1 })
    );
    expect(delta.formationRate).toBe(0);
    expect(delta.chainLockCoverage).toBe(0);
  });

  it('compares block spacing, which a profile change is expected to move', () => {
    const delta = compareOutcomes(
      outcome({ medianBlockIntervalSec: 300 }),
      outcome({ medianBlockIntervalSec: 150 })
    );
    expect(delta.medianBlockIntervalSec).toBe(150);
  });

  it('compares concentration, which the producer count alone hides', () => {
    // The case that motivated the field: the dominant staker stops, so the
    // count barely moves -- the other producers were already there -- while
    // the share it took falls by three quarters. A delta built on the count
    // would report the intervention as having done almost nothing.
    const delta = compareOutcomes(
      outcome({ distinctStakers: 42, topStakerShare: 0.11 }),
      outcome({ distinctStakers: 41, topStakerShare: 0.44 })
    );
    expect(delta.topStakerShare).toBeCloseTo(-0.33, 10);
  });

  it('reports no concentration change for a run closed before the field existed', () => {
    // Absent is not zero: a run snapshotted without the figure must not read
    // as "production was perfectly spread".
    expect(compareOutcomes(outcome({ topStakerShare: 0.44 }), outcome({})).topStakerShare).toBeNull();
    expect(compareOutcomes(outcome({}), outcome({ topStakerShare: 0.44 })).topStakerShare).toBeNull();
  });
});

describe('the Sentinel convergence delta', () => {
  it('is the signed change in convergence, and null where a side carried no epochs', () => {
    const withEpochs = (rate: number | null) =>
      outcome({ dsl: rate === null ? null : { epochs: 60, committed: Math.round(rate * 60), absent: 60 - Math.round(rate * 60), missedBits: 0, convergenceRate: rate } });

    expect(compareOutcomes(withEpochs(1), withEpochs(0.9517)).dslConvergenceRate).toBeCloseTo(0.0483, 6);
    // Neither an outcome frozen before epochs were carried nor a window that
    // judged none has a rate; the delta must say so rather than say zero.
    expect(compareOutcomes(withEpochs(1), outcome({})).dslConvergenceRate).toBeNull();
    expect(compareOutcomes(withEpochs(null), withEpochs(1)).dslConvergenceRate).toBeNull();
  });
});
