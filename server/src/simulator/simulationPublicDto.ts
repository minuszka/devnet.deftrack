import type {
  SimulationDataQualitySnapshot,
  SimulationNetwork,
  SimulationPreflightResult,
  SimulationTargetRole,
} from '../models/SimulationRun.js';
import type { SimulationRunState } from '../domain/simulationRunState.js';
import { parseScenarioRequest, SCENARIO_REGISTRY } from './scenarioRegistry.js';

/**
 * Mandatory Mongo allowlist for every public simulation query.
 * Never replace with `.select('metadata')` or an unprojected `.lean()`.
 */
export const PUBLIC_SIMULATION_RUN_PROJECTION = [
  'runKey',
  'metadata.network',
  'metadata.scenarioId',
  'metadata.scenarioVersion',
  'metadata.parameters',
  'metadata.seed',
  'metadata.targetSnapshot.targetId',
  'metadata.targetSnapshot.displayLabel',
  'metadata.targetSnapshot.proTxHash',
  'metadata.targetSnapshot.role',
  'metadata.experimentRunKey',
  'metadata.baselineRunKey',
  'state',
  'preflight.checkId',
  'preflight.severity',
  'preflight.passed',
  'preflight.checkedAtMs',
  'preflight.publicMessage',
  'dataQuality',
  'createdAt',
  'updatedAt',
].join(' ');

export interface PublicSimulationRunSource {
  runKey: string;
  metadata: {
    network: SimulationNetwork;
    scenarioId: string;
    scenarioVersion: number;
    parameters: Record<string, unknown>;
    seed: string;
    targetSnapshot: Array<{
      targetId: string;
      displayLabel: string;
      proTxHash: string | null;
      role: SimulationTargetRole;
    }>;
    experimentRunKey: string | null;
    baselineRunKey: string | null;
  };
  state: SimulationRunState;
  preflight: SimulationPreflightResult[];
  dataQuality: SimulationDataQualitySnapshot | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

function iso(value: Date | string | undefined): string | null {
  if (value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function toPublicSimulationRun(source: PublicSimulationRunSource) {
  // Re-parse persisted Mixed parameters before exposing them. Corrupt/legacy
  // unknown fields fail closed rather than bypassing today's public contract.
  const scenario = parseScenarioRequest({
    scenarioId: source.metadata.scenarioId,
    scenarioVersion: source.metadata.scenarioVersion,
    seed: source.metadata.seed,
    parameters: source.metadata.parameters,
  });
  const descriptor = SCENARIO_REGISTRY[scenario.scenarioId];
  return {
    runKey: source.runKey,
    network: source.metadata.network,
    scenario: {
      id: scenario.scenarioId,
      version: scenario.scenarioVersion,
      title: descriptor.title,
      riskClass: descriptor.riskClass,
      parameters: scenario.parameters,
      seed: scenario.seed,
    },
    targets: source.metadata.targetSnapshot.map((target) => ({
      targetId: target.targetId,
      displayLabel: target.displayLabel,
      proTxHash: target.proTxHash,
      role: target.role,
    })),
    state: {
      status: source.state.status,
      revision: source.state.revision,
      live: source.state.live,
      createdAtMs: source.state.createdAtMs,
      updatedAtMs: source.state.updatedAtMs,
      stateEnteredAtMs: source.state.stateEnteredAtMs,
      runExpiresAtMs: source.state.runExpiresAtMs,
      faultLeaseExpiresAtMs: source.state.faultLeaseExpiresAtMs,
      faultMayBeActive: source.state.faultMayBeActive,
      abortRequested: source.state.abortRequested,
      lastTransition: source.state.lastTransition,
    },
    preflight: source.preflight.map((item) => ({
      checkId: item.checkId,
      severity: item.severity,
      passed: item.passed,
      checkedAtMs: item.checkedAtMs,
      publicMessage: item.publicMessage,
    })),
    dataQuality: source.dataQuality,
    experimentRunKey: source.metadata.experimentRunKey,
    baselineRunKey: source.metadata.baselineRunKey,
    createdAt: iso(source.createdAt),
    updatedAt: iso(source.updatedAt),
  };
}
