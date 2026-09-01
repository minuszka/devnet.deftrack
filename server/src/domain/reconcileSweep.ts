import { RECONCILABLE_SIMULATION_STATUSES } from './simulationRunState.js';

/**
 * The persisted runs a reconcile sweep should look at: those a reconcile can act
 * on, narrowed to the ones actually due -- an abort in progress, or a run or
 * fault lease whose deadline has passed. reconcilePersistedSimulationRun is the
 * authority and no-ops on anything not truly due; this filter only keeps the
 * sweep from loading every run each tick.
 *
 * Pure, so the query shape is tested without a database.
 */
export function reconcilableRunFilter(nowMs: number): Record<string, unknown> {
  return {
    'state.status': { $in: [...RECONCILABLE_SIMULATION_STATUSES] },
    $or: [
      // Resumed regardless of any deadline.
      { 'state.status': 'aborting' },
      // The run's overall envelope has expired.
      { 'state.runExpiresAtMs': { $lte: nowMs } },
      // A fault may still be applied and its lease has lapsed.
      { 'state.faultMayBeActive': true, 'state.faultLeaseExpiresAtMs': { $lte: nowMs } },
    ],
  };
}
