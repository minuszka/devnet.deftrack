import type { SimulationScenarioRequest } from './scenarioRegistry.js';
import type { CoreSimulatorReference } from './scenarioTypes.js';

const REPOSITORY = 'https://github.com/minuszka/defcon-chainlock-pose-simulator';
const SUMMARY_ARTIFACT = 'results-summary.csv';

/**
 * Links a live scenario to already-produced Core-native simulation evidence.
 * This adapter intentionally performs no filesystem access and no probability
 * or quorum calculation; the Core simulator remains the source of truth.
 */
export function coreSimulatorReferenceFor(
  request: SimulationScenarioRequest
): CoreSimulatorReference {
  const base = {
    repository: REPOSITORY,
    profile: 'q60_44_41' as const,
    artifacts: [SUMMARY_ARTIFACT],
  };

  switch (request.scenarioId) {
    case 'mn-stop':
      return {
        ...base,
        status: 'modeled',
        scenarioFamilies: ['independent_offline'],
        note: 'The artifact models random offline masternodes; it is evidence, not a live prediction.',
      };
    case 'host-outage':
      return {
        ...base,
        status: 'modeled',
        scenarioFamilies: ['operator_concentration', 'restart_storm'],
        note: 'Use the concentration and restart rows as bounds; the exact registered host is not recomputed here.',
      };
    case 'quorum-member-outage':
      return {
        ...base,
        status: 'modeled',
        scenarioFamilies: ['availability_classes', 'selection_summary'],
        note: 'Threshold margins use the selected live quorum; stochastic selection remains in the Core simulator.',
      };
    case 'staker-stop':
      return {
        ...base,
        status: 'not-modeled',
        scenarioFamilies: [],
        artifacts: [],
        note: 'The current Core-native suite models quorum/PoSe behavior, not PoS chain production.',
      };
    case 'restart-flapping':
      return {
        ...base,
        status: 'modeled',
        scenarioFamilies: ['flapping', 'restart_storm'],
        note: 'The artifact is a population model and is not recalculated from this target list.',
      };
    case 'network-degradation':
      return {
        ...base,
        status: 'modeled',
        scenarioFamilies: ['delayed_dkg_messages'],
        note: 'Delay evidence is linked only; live latency, jitter and loss are not converted into simulated odds.',
      };
    case 'node-isolation':
      return {
        ...base,
        status: 'modeled',
        scenarioFamilies: ['partial_network_partition'],
        note: 'The artifact covers partition ratios; this adapter does not claim exact topology equivalence.',
      };
    case 'clear-recover':
      return {
        ...base,
        status: 'not-modeled',
        scenarioFamilies: [],
        artifacts: [],
        note: 'Recovery is an orchestrator safety action, not a Core simulation scenario.',
      };
  }
}
