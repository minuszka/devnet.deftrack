import { describe, expect, it } from 'vitest';
import { interventionsCovering, type InterventionRun } from './roundInterventions.js';

const run = (over: Partial<InterventionRun>): InterventionRun => ({
  runKey: 'run',
  title: 'a run',
  kind: 'binary-rollout',
  status: 'closed',
  startHeight: 0,
  endHeight: null,
  ...over,
});

describe('which interventions cover a round', () => {
  // The case that made this exist: the 2026-09-10 rollout run, opened at
  // 10915 and closed at 10983, and the llmq_defcon round at base 10920.
  const roll = run({ runKey: 'fleet-rollout-222-2026-09-10', startHeight: 10915, endHeight: 10983 });
  const q60 = { expectedHeight: 10920, dkgInterval: 24 };

  it('names the run whose window meets the round\'s DKG span', () => {
    expect(interventionsCovering(q60, [roll])).toEqual([
      { runKey: 'fleet-rollout-222-2026-09-10', title: 'a run', kind: 'binary-rollout', status: 'closed' },
    ]);
  });

  it('the span is half-open: a run starting at the next base does not cover this round', () => {
    expect(interventionsCovering(q60, [run({ startHeight: 10944, endHeight: 10990 })])).toEqual([]);
    // ... but one that starts on the round's last block does.
    expect(interventionsCovering(q60, [run({ startHeight: 10943, endHeight: 10990 })])).toHaveLength(1);
  });

  it('a run that ended before the base is not a cause of anything after it', () => {
    expect(interventionsCovering(q60, [run({ startHeight: 10800, endHeight: 10919 })])).toEqual([]);
    expect(interventionsCovering(q60, [run({ startHeight: 10800, endHeight: 10920 })])).toHaveLength(1);
  });

  it('an open run reaches the tip and covers every later round', () => {
    expect(interventionsCovering({ expectedHeight: 20000, dkgInterval: 24 }, [run({ startHeight: 10915, endHeight: null })])).toHaveLength(1);
  });

  it('lists several in the order they started', () => {
    const later = run({ runKey: 'later', startHeight: 10930, endHeight: 10935 });
    expect(interventionsCovering(q60, [later, roll]).map((r) => r.runKey)).toEqual([
      'fleet-rollout-222-2026-09-10',
      'later',
    ]);
  });
});
