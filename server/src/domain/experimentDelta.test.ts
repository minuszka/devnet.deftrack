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
