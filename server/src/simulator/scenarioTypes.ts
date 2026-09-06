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
  'dsl-fault',
] as const;

export type SimulationScenarioId = (typeof SIMULATION_SCENARIO_IDS)[number];

/**
 * The Sentinel Layer faults the node's own injector knows (`faultinject set`,
 * devnet/regtest only). Spelled exactly as the RPC spells them, so the wrapper
 * passes them through untouched and an unknown kind is refused by the node.
 */
export const DSL_FAULT_KINDS = [
  'response-drop',
  'report-drop',
  'response-delay',
  'report-delay',
  'commitment-skip',
] as const;
export type DslFaultKind = (typeof DSL_FAULT_KINDS)[number];

/** Blocks per DSL epoch on the regtest lab and the devnet alike (`nDSLEpochInterval`). */
export const DSL_EPOCH_BLOCKS = 24;
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
  | {
      /**
       * Arm one Sentinel Layer fault on the target's own node for `epochs`
       * epochs, counted from the next epoch boundary: the wrapper reads the
       * node's height, arms `faultinject set` with an expiry at
       * boundary + epochs * DSL_EPOCH_BLOCKS, and the node retires it by height
       * on its own. `faultLeaseSeconds` is the wrapper's own, second, clock.
       */
      kind: 'dsl-fault-apply';
      faultKind: DslFaultKind;
      epochs: number;
      /** Delay in blocks for the *-delay kinds; 0 otherwise. */
      param: number;
      faultLeaseSeconds: number;
    }
  | { kind: 'dsl-fault-clear'; faultKind: DslFaultKind }
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
  /**
   * The thresholds of the profile actually in force, not literals.
   *
   * They were pinned to Q60's 44 and 41. On the lab, whose profile is 3/2/2 or
   * whatever `-llmqtestparams` sets, every preview then measured a devnet
   * network that was not there: the margin was always negative and every report
   * came back degraded or not evaluable, whatever the fault did.
   */
  dkgThreshold: number | null;
  chainLockThreshold: number | null;
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
  /**
   * The thresholds the profile in force actually uses. Null when the profile is
   * not known here, which is reported as unknown rather than assumed.
   */
  quorumThresholds?: { dkg: number | null; chainLock: number | null };
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
