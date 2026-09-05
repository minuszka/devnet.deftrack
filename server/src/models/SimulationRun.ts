import mongoose, { Schema, type Document } from 'mongoose';
import {
  SIMULATION_RUN_EVENT_TYPES,
  SIMULATION_RUN_STATUSES,
  type SimulationRunState,
  type SimulationTransitionRecord,
} from '../domain/simulationRunState.js';

export type SimulationNetwork = 'regtest' | 'devnet';
export type SimulationTargetRole = 'masternode' | 'staker' | 'seed';
export type SimulationTargetCapability =
  | 'service-control'
  | 'netem-p2p'
  | 'partition-p2p'
  | 'dsl-test-hook';

export interface SimulationAuditActor {
  actorId: string;
  actorType: 'admin-session' | 'orchestrator' | 'system';
  displayName: string | null;
}

export interface SimulationTargetSnapshot {
  targetId: string;
  displayLabel: string;
  operatorId: string | null;
  proTxHash: string | null;
  /** Private registry reference. Never return from a public DTO. */
  hostRef: string;
  /**
   * The host the chain sees, when it differs from hostRef. See the target model.
   *
   * Optional, not nullable-required: absent and null both mean "the same as
   * hostRef", and canonicalJson drops undefined -- so a devnet run's fingerprint
   * is byte-identical to one taken before this field existed.
   */
  chainHostRef?: string | null;
  /** Private local allowlist reference, not a caller-supplied unit name. */
  unitRef: string;
  p2pPort: number;
  role: SimulationTargetRole;
  network: SimulationNetwork;
  capabilities: SimulationTargetCapability[];
  expectedBuild: string | null;
  capturedAtMs: number;
  capturedAtHeight: number;
}

/**
 * A resolved member list for one identified quorum.  It contains no private
 * host or unit reference: those stay in targetSnapshot.  The fingerprint binds
 * the quorum identity and the canonical proTxHash -> targetId resolution that
 * was checked at draft/arm time.
 */
export interface SimulationQuorumTargetReference {
  llmqType: number;
  llmqName: string;
  quorumHash: string;
  expectedHeight: number;
  quorumIndex: number;
  capturedAtHeight: number;
  memberProTxHashes: string[];
  memberTargetIds: string[];
  resolutionFingerprint: string;
}

/**
 * Current and (only when authoritatively observed) next quorum resolution.
 * A missing next member list is explicit rather than a predicted fault target.
 */
export interface SimulationQuorumTargetSnapshot {
  current: SimulationQuorumTargetReference | null;
  next: SimulationQuorumTargetReference | null;
  nextUnavailableReason: string | null;
}

export interface SimulationRunMetadata {
  network: SimulationNetwork;
  scenarioId: string;
  scenarioVersion: number;
  /** Strict Zod validation is applied by the day-4 scenario registry. */
  parameters: Record<string, unknown>;
  seed: string;
  targetSnapshot: SimulationTargetSnapshot[];
  quorumTargetSnapshot: SimulationQuorumTargetSnapshot | null;
  experimentRunKey: string | null;
  baselineRunKey: string | null;
  requestedBy: SimulationAuditActor;
}

export interface SimulationPreflightResult {
  checkId: string;
  severity: 'required' | 'warning';
  passed: boolean;
  checkedAtMs: number;
  publicMessage: string;
  privateDetail: string | null;
}

export interface SimulationRecoveryTargetResult {
  targetId: string;
  faultStateClear: boolean;
  expectedServiceRunning: boolean;
  observerFresh: boolean;
  checkedAtMs: number;
  privateDetail: string | null;
}

export interface SimulationRecoveryResult {
  required: boolean;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  targets: SimulationRecoveryTargetResult[];
  allClear: boolean;
}

export interface SimulationDataQualitySnapshot {
  observerCoveragePercent: number;
  staleTargetCount: number;
  explorerLagBlocks: number;
  missingHeights: number[];
  confidence: 'high' | 'medium' | 'low';
}

export interface SimulationRunDocument extends Document {
  runKey: string;
  metadataFingerprint: string;
  metadata: SimulationRunMetadata;
  state: SimulationRunState;
  preflight: SimulationPreflightResult[];
  recovery: SimulationRecoveryResult;
  dataQuality: SimulationDataQualitySnapshot | null;
  /** Set once when the run's boundaries leave nothing to measure; see the schema. */
  measurement: { unavailable: true; reason: string; decidedAtMs: number } | null;
  /**
   * When this run's measurement report was written, if it was.
   *
   * Kept on the run so the finalize sweep can EXCLUDE reported runs in its
   * query instead of fetching a page and filtering it afterwards. Filtering
   * afterwards starves: a finalized run's state never changes again, so the
   * fifty oldest reported runs permanently filled the page and no newer run
   * was ever offered.
   */
  measurementReportedAtMs: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export const simulationAuditActorSchema = new Schema<SimulationAuditActor>(
  {
    actorId: { type: String, required: true },
    actorType: {
      type: String,
      enum: ['admin-session', 'orchestrator', 'system'],
      required: true,
    },
    displayName: { type: String, default: null },
  },
  { _id: false, strict: 'throw' }
);

const targetSnapshotSchema = new Schema<SimulationTargetSnapshot>(
  {
    targetId: { type: String, required: true },
    displayLabel: { type: String, required: true },
    operatorId: { type: String, default: null },
    proTxHash: { type: String, default: null },
    hostRef: { type: String, required: true },
    chainHostRef: { type: String, default: null },
    unitRef: { type: String, required: true },
    p2pPort: { type: Number, required: true, min: 1, max: 65_535 },
    role: { type: String, enum: ['masternode', 'staker', 'seed'], required: true },
    network: { type: String, enum: ['regtest', 'devnet'], required: true },
    capabilities: [
      {
        type: String,
        enum: ['service-control', 'netem-p2p', 'partition-p2p', 'dsl-test-hook'],
      },
    ],
    expectedBuild: { type: String, default: null },
    capturedAtMs: { type: Number, required: true, min: 0 },
    capturedAtHeight: { type: Number, required: true, min: 0 },
  },
  { _id: false, strict: 'throw' }
);

const quorumTargetReferenceSchema = new Schema<SimulationQuorumTargetReference>(
  {
    llmqType: { type: Number, required: true },
    llmqName: { type: String, required: true },
    quorumHash: { type: String, required: true, match: /^[0-9a-f]{64}$/i },
    expectedHeight: { type: Number, required: true, min: 0 },
    quorumIndex: { type: Number, required: true, min: 0 },
    capturedAtHeight: { type: Number, required: true, min: 0 },
    memberProTxHashes: [{ type: String, required: true, match: /^[0-9a-f]{64}$/i }],
    memberTargetIds: [{ type: String, required: true }],
    resolutionFingerprint: { type: String, required: true, match: /^[0-9a-f]{64}$/i },
  },
  { _id: false, strict: 'throw' }
);

const quorumTargetSnapshotSchema = new Schema<SimulationQuorumTargetSnapshot>(
  {
    current: { type: quorumTargetReferenceSchema, default: null },
    next: { type: quorumTargetReferenceSchema, default: null },
    nextUnavailableReason: { type: String, default: null },
  },
  { _id: false, strict: 'throw' }
);

export const simulationRunMetadataSchema = new Schema<SimulationRunMetadata>(
  {
    network: { type: String, enum: ['regtest', 'devnet'], required: true },
    scenarioId: { type: String, required: true },
    scenarioVersion: { type: Number, required: true, min: 1 },
    parameters: { type: Schema.Types.Mixed, required: true },
    seed: { type: String, required: true },
    targetSnapshot: { type: [targetSnapshotSchema], default: [] },
    quorumTargetSnapshot: { type: quorumTargetSnapshotSchema, default: null },
    experimentRunKey: { type: String, default: null },
    baselineRunKey: { type: String, default: null },
    requestedBy: { type: simulationAuditActorSchema, required: true },
  },
  { _id: false, strict: 'throw' }
);

const allTransitionEventTypes = [
  ...SIMULATION_RUN_EVENT_TYPES,
  'system_timeout',
  'system_resume_recovery',
  'system_cooldown_complete',
] as const;

const transitionSchema = new Schema<SimulationTransitionRecord>(
  {
    eventId: { type: String, required: true },
    eventType: { type: String, enum: allTransitionEventTypes, required: true },
    from: { type: String, enum: SIMULATION_RUN_STATUSES, required: true },
    to: { type: String, enum: SIMULATION_RUN_STATUSES, required: true },
    atMs: { type: Number, required: true, min: 0 },
    reason: { type: String, default: null },
  },
  { _id: false, strict: 'throw' }
);

const chainAnchorSchema = new Schema<{ height: number; hash: string }>(
  {
    height: { type: Number, required: true, min: 0 },
    // A height is not an identity: after a reorg the block at that height is a
    // different block, so the hash is what lets a later reader tell.
    hash: { type: String, required: true },
  },
  { _id: false, strict: 'throw' }
);

const measurementOutcomeSchema = new Schema<{ unavailable: true; reason: string; decidedAtMs: number }>(
  {
    unavailable: { type: Boolean, required: true },
    reason: { type: String, required: true },
    decidedAtMs: { type: Number, required: true, min: 0 },
  },
  { _id: false, strict: 'throw' }
);

export const simulationRunStateSchema = new Schema<SimulationRunState>(
  {
    runKey: { type: String, required: true },
    status: { type: String, enum: SIMULATION_RUN_STATUSES, required: true },
    revision: { type: Number, required: true, min: 0 },
    live: { type: Boolean, required: true },
    createdAtMs: { type: Number, required: true, min: 0 },
    updatedAtMs: { type: Number, required: true, min: 0 },
    stateEnteredAtMs: { type: Number, required: true, min: 0 },
    runExpiresAtMs: { type: Number, required: true, min: 0 },
    faultLeaseExpiresAtMs: { type: Number, default: null, min: 0 },
    /**
     * When the cooldown ends, carried separately from `runExpiresAtMs`.
     *
     * Optional in the domain and so optional here, but it must EXIST in this
     * schema: `strict: 'throw'` rejects an unknown path even when the value is
     * undefined, and this sub-schema is also the audit event's `stateAfter`. A
     * field added to the state and not to this list therefore does not degrade --
     * it makes the first transition that carries it unwritable, which is every
     * live run at its first preflight.
     */
    cooldownExpiresAtMs: { type: Number, default: undefined, min: 0 },
    // Same rule as above: a field on the state that is not named here makes the
    // first transition carrying it unwritable, because this sub-schema throws on
    // an unknown path and is also the audit event's stateAfter.
    faultActivatedTip: { type: chainAnchorSchema, default: undefined },
    recoveredTip: { type: chainAnchorSchema, default: undefined },
    faultMayBeActive: { type: Boolean, required: true },
    abortRequested: { type: Boolean, required: true },
    lastTransition: { type: transitionSchema, default: null },
  },
  { _id: false, strict: 'throw' }
);

const preflightSchema = new Schema<SimulationPreflightResult>(
  {
    checkId: { type: String, required: true },
    severity: { type: String, enum: ['required', 'warning'], required: true },
    passed: { type: Boolean, required: true },
    checkedAtMs: { type: Number, required: true, min: 0 },
    publicMessage: { type: String, required: true },
    privateDetail: { type: String, default: null },
  },
  { _id: false, strict: 'throw' }
);

const recoveryTargetSchema = new Schema<SimulationRecoveryTargetResult>(
  {
    targetId: { type: String, required: true },
    faultStateClear: { type: Boolean, required: true },
    expectedServiceRunning: { type: Boolean, required: true },
    observerFresh: { type: Boolean, required: true },
    checkedAtMs: { type: Number, required: true, min: 0 },
    privateDetail: { type: String, default: null },
  },
  { _id: false, strict: 'throw' }
);

const recoverySchema = new Schema<SimulationRecoveryResult>(
  {
    required: { type: Boolean, default: false },
    startedAtMs: { type: Number, default: null, min: 0 },
    finishedAtMs: { type: Number, default: null, min: 0 },
    targets: { type: [recoveryTargetSchema], default: [] },
    allClear: { type: Boolean, default: false },
  },
  { _id: false, strict: 'throw' }
);

const dataQualitySchema = new Schema<SimulationDataQualitySnapshot>(
  {
    observerCoveragePercent: { type: Number, required: true, min: 0, max: 100 },
    staleTargetCount: { type: Number, required: true, min: 0 },
    explorerLagBlocks: { type: Number, required: true, min: 0 },
    missingHeights: [{ type: Number, min: 0 }],
    confidence: { type: String, enum: ['high', 'medium', 'low'], required: true },
  },
  { _id: false, strict: 'throw' }
);

export const simulationRunSchema = new Schema<SimulationRunDocument>(
  {
    runKey: { type: String, required: true, unique: true, immutable: true },
    metadataFingerprint: { type: String, required: true, immutable: true },
    metadata: { type: simulationRunMetadataSchema, required: true, immutable: true },
    state: { type: simulationRunStateSchema, required: true },
    preflight: { type: [preflightSchema], default: [] },
    recovery: { type: recoverySchema, default: () => ({ required: false, targets: [], allClear: false }) },
    dataQuality: { type: dataQualitySchema, default: null },
    /**
     * Set when the run's own boundaries leave nothing to measure, so the sweep
     * stops offering it for finalization. Root-level on purpose: it is not part
     * of the state machine, and the state sub-schema is also the audit event's
     * stateAfter, where an extra field would change what replay must reproduce.
     */
    measurement: { type: measurementOutcomeSchema, default: null },
    measurementReportedAtMs: { type: Number, default: null },
  },
  { timestamps: true, strict: 'throw', versionKey: false }
);

simulationRunSchema.index({ 'state.status': 1, createdAt: -1 });
simulationRunSchema.index({ 'metadata.scenarioId': 1, createdAt: -1 });
simulationRunSchema.index({ 'metadata.experimentRunKey': 1 }, { sparse: true });

simulationRunSchema.pre('validate', function validateRunProjection() {
  if (this.state.runKey !== this.runKey) {
    this.invalidate('state.runKey', 'state runKey must match projection runKey');
  }
  if (
    this.state.updatedAtMs < this.state.createdAtMs ||
    this.state.stateEnteredAtMs < this.state.createdAtMs ||
    this.state.runExpiresAtMs <= this.state.createdAtMs
  ) {
    this.invalidate('state', 'simulation state timestamps are inconsistent');
  }
  if (this.metadata.targetSnapshot.some((target) => target.network !== this.metadata.network)) {
    this.invalidate('metadata.targetSnapshot', 'target network must match run network');
  }
});

export const SimulationRun = mongoose.model<SimulationRunDocument>(
  'SimulationRun',
  simulationRunSchema
);
