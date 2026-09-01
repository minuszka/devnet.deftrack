import { describe, expect, it } from 'vitest';
import { reconcilableRunFilter } from './reconcileSweep.js';
import { RECONCILABLE_SIMULATION_STATUSES } from './simulationRunState.js';

const NOW = 2_000_000;

describe('reconcilableRunFilter', () => {
  it('narrows to reconcilable statuses that are actually due', () => {
    const filter = reconcilableRunFilter(NOW) as any;
    expect(filter['state.status']).toEqual({ $in: [...RECONCILABLE_SIMULATION_STATUSES] });
    expect(filter.$or).toEqual([
      { 'state.status': 'aborting' },
      { 'state.runExpiresAtMs': { $lte: NOW } },
      { 'state.faultMayBeActive': true, 'state.faultLeaseExpiresAtMs': { $lte: NOW } },
    ]);
  });

  it('includes aborting among the candidate statuses so it is swept regardless of deadline', () => {
    expect(RECONCILABLE_SIMULATION_STATUSES).toContain('aborting');
    expect(RECONCILABLE_SIMULATION_STATUSES).toContain('fault_active');
    // Terminal / operator-waiting statuses are not swept.
    expect(RECONCILABLE_SIMULATION_STATUSES).not.toContain('completed');
    expect(RECONCILABLE_SIMULATION_STATUSES).not.toContain('draft');
  });
});
