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

/**
 * A descriptor as the control API serves it: the metadata above, plus a
 * parameter object that satisfies this scenario's schema.
 *
 * The template exists so the panel never has to carry its own copy of what a
 * scenario takes. A separately maintained table drifts from the validator, and
 * it did: the panel had no entry for `dsl-fault` and offered `{}`, which is
 * three required fields short.
 *
 * A template is a starting point, never a run. `templateNeedsTargetId` says the
 * operator must replace a placeholder before the server could resolve it --
 * satisfying the schema and naming a registered target are different questions,
 * answered in different places.
 */
export interface ScenarioCatalogueEntry extends ScenarioDescriptor {
  parameterTemplate: Record<string, unknown>;
  templateNeedsTargetId: boolean;
}

/**
 * What this deployment can actually be asked to do, taken from the same
 * configuration decision that builds the executor.
 *
 * The panel offered `live` beside `devnet` and the server refused the pair at
 * creation -- correctly, since the only executor is the Docker lab. Offering a
 * combination that is always refused is not a safety feature, it is a trap, and
 * guessing the answer from a hostname would be a second source of truth.
 *
 * `liveExecutorConfigured` says an executor exists. It says nothing about
 * whether a run would pass preflight; that remains a separate question with a
 * separate answer.
 */
export interface SimulationCapabilities {
  liveExecutorConfigured: boolean;
  /** The networks a live run may name. Empty when live is impossible here. */
  liveNetworks: SimulationNetwork[];
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
  /**
   * What the Sentinel Layer's boundary commitments should say while the plan
   * runs. Declared at dry-run time like the quorum margins above, so the report
   * compares the chain against a prediction and never against a story fitted
   * to the result. Absent on plans that do not touch the Sentinel.
   */
  dsl?: DslImpactExpectation;
}

export interface DslImpactExpectation {
  faultKind: DslFaultKind;
  epochs: number;
  /**
   * The members the commitment should name, and nobody else. Empty means the
   * fault is expected to leave every commitment clean (a dropped report changes
   * one node's view, not the pool's verdict).
   */
  expectedMissedProTxHashes: string[];
  /**
   * False when the plan cannot say what the chain will show: a skipped
   * commitment is absent only if nobody else mines the boundary.
   */
  evaluable: boolean;
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
