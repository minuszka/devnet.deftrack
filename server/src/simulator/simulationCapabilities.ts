import type { SimulationCapabilities } from './scenarioTypes.js';

/**
 * The only network a live run may name.
 *
 * Stated once. The create-run schema refuses every other network for a live
 * run, and the panel needs the same fact to stop offering a combination that is
 * always refused -- two copies of that rule would eventually disagree, and the
 * disagreement would show up as a trap in the UI rather than as a failing test.
 */
export const LIVE_NETWORKS = ['regtest'] as const;

/**
 * What this deployment can be asked to do, from whether an executor exists.
 *
 * Pure on purpose: the decision itself is read from configuration in exactly
 * one place (`labExecutorConfigured`), and this turns that one boolean into the
 * answer the panel reads. Nothing here guesses from a hostname or an
 * environment name.
 *
 * Note what it does not say. An executor existing is not a preflight passing:
 * chain identity, data quality, target mapping and recovery readiness are all
 * still checked when a run is validated, and any of them can refuse.
 */
export function simulationCapabilitiesFrom(executorConfigured: boolean): SimulationCapabilities {
  return {
    liveExecutorConfigured: executorConfigured,
    liveNetworks: executorConfigured ? [...LIVE_NETWORKS] : [],
  };
}
