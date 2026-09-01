import type {
  SimulationNetwork,
  SimulationTargetRole,
  SimulationTargetSnapshot,
} from '../models/SimulationRun.js';

export const SIMULATION_SCENARIO_IDS = [
  'mn-stop',
  'host-outage',
  'quorum-member-outage',
  'staker-stop',
  'restart-flapping',
  'network-degradation',
  'node-isolation',
  'clear-recover',
] as const;

export type SimulationScenarioId = (typeof SIMULATION_SCENARIO_IDS)[number];
export type SimulationRiskClass = 'low' | 'medium' | 'high';

export interface ScenarioDescriptor {
  scenarioId: SimulationScenarioId;
  version: 1;
  title: string;
  description: string;
  riskClass: SimulationRiskClass;
}

export type PlannedActionPayload =
  | { kind: 'service-stop'; faultLeaseSeconds: number }
  | { kind: 'service-start' }
  | {
      kind: 'netem-apply';
      interfaceRef: 'devnet-p2p';
      latencyMs: number;
      jitterMs: number;
      lossPercent: number;
      correlationPercent: number;
      faultLeaseSeconds: number;
    }
  | {
      kind: 'partition-apply';
      p2pPortRef: 'devnet-p2p';
      peerTargetIds: string[];
      faultLeaseSeconds: number;
    }
  | { kind: 'fault-clear'; scope: 'run' };

export interface PlannedSimulationAction {
  actionId: string;
  runKey: string;
  sequence: number;
  targetId: string;
  kind: PlannedActionPayload['kind'];
  payload: PlannedActionPayload;
  payloadDigest: string;
  notBeforeOffsetMs: number;
  expiresAfterMs: number;
  maxAttempts: number;
}

export interface CoreSimulatorReference {
  status: 'modeled' | 'not-modeled';
  repository: string;
  profile: 'q60_44_41';
  scenarioFamilies: string[];
  artifacts: string[];
  note: string;
}

export interface DryRunImpactEstimate {
  affectedTargetCount: number;
  affectedMasternodeCount: number;
  affectedStakerCount: number;
  affectedHostCount: number;
  affectedCurrentQuorumMembers: number;
  currentQuorumSize: number | null;
  survivingCurrentQuorumMembers: number | null;
  dkgThreshold: 44;
  chainLockThreshold: 41;
  dkgMarginAfterFault: number | null;
  chainLockMarginAfterFault: number | null;
  warnings: string[];
}

export interface DryRunContext {
  network: SimulationNetwork;
  currentHeight: number;
  targets: readonly SimulationTargetSnapshot[];
  /** Exact members of the quorum relevant to this preview, if known. */
  quorumMemberTargetIds: readonly string[];
}

export interface DryRunRequest {
  runKey: string;
  network: SimulationNetwork;
  scenario: unknown;
}

export interface DryRunPlan {
  mode: 'dry-run';
  runKey: string;
  network: SimulationNetwork;
  scenarioId: SimulationScenarioId;
  scenarioVersion: 1;
  seed: string;
  parameters: Record<string, unknown>;
  selectedTargetIds: string[];
  selectedRoles: SimulationTargetRole[];
  actions: PlannedSimulationAction[];
  impact: DryRunImpactEstimate;
  coreSimulator: CoreSimulatorReference;
  planFingerprint: string;
  assurances: readonly [
    'NO_DATABASE_WRITE',
    'NO_RPC_CALL',
    'NO_REMOTE_ACTION',
    'NO_FAULT_APPLIED',
  ];
}
