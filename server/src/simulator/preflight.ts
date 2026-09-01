import type {
  SimulationDataQualitySnapshot,
  SimulationPreflightResult,
} from '../models/SimulationRun.js';
import type { BaselineEvidence, MeasurementWindowPlan } from './measurementWindows.js';
import { baselineEvidenceSatisfies } from './measurementWindows.js';
import type { TargetInventoryResolution, TargetResolutionIssueCode } from './targetResolver.js';

export const SIMULATION_PREFLIGHT_CHECK_IDS = [
  'network-identity',
  'chain-synced',
  'explorer-synced',
  'target-resolved',
  'target-build-match',
  'observer-fresh',
  'targets-active',
  'no-active-experiment',
  'recovery-ready',
  'quorum-stable',
  'baseline-ready',
] as const;

export type SimulationPreflightCheckId = (typeof SIMULATION_PREFLIGHT_CHECK_IDS)[number];

export interface SimulationPreflightPolicy {
  expectedChain: string;
  expectedGenesisHash: string;
  expectedWrapperVersion: string;
  maxExplorerLagBlocks: number;
  maxExplorerAgeMs: number;
  maxObserverAgeMs: number;
  maxTargetSnapshotAgeMs: number;
  minObserverCoveragePercent: number;
  maxStaleTargets: number;
  maxWorkerAgeMs: number;
  expectedQuorumSize: number;
}

export interface RecoveryTargetEvidence {
  targetId: string;
  available: boolean;
  faultStateClean: boolean;
  wrapperVersion: string | null;
}

export interface SimulationPreflightInput {
  nowMs: number;
  policy: SimulationPreflightPolicy;
  chain: {
    chain: string;
    genesisHash: string;
    blocks: number;
    headers: number;
    initialBlockDownload: boolean;
  };
  explorer: {
    indexedHeight: number;
    lastSyncedAtMs: number | null;
    syncError: string | null;
    missingHeights: number[];
  };
  targetInventory: TargetInventoryResolution;
  selectedTargetIds: string[];
  observer: {
    coveragePercent: number;
    staleTargetCount: number;
    lastObservationAtMs: number | null;
    sequenceGapCount: number;
  };
  conflicts: {
    otherLiveRunKeys: string[];
    otherRunningExperimentKeys: string[];
  };
  recovery: {
    required: boolean;
    workerLastSeenAtMs: number | null;
    targets: RecoveryTargetEvidence[];
  };
  quorum: {
    required: boolean;
    stable: boolean;
    capturedAtHeight: number | null;
    memberTargetIds: string[];
  };
  baseline: {
    required: boolean;
    plan: MeasurementWindowPlan;
    evidence: BaselineEvidence | null;
  };
}

export interface SimulationPreflightEvaluation {
  passed: boolean;
  checkedAtMs: number;
  checks: SimulationPreflightResult[];
  dataQuality: SimulationDataQualitySnapshot;
}

const BUILD_ISSUES = new Set<TargetResolutionIssueCode>([
  'EXPECTED_BUILD_MISSING',
  'NODE_BUILD_UNKNOWN',
  'NODE_BUILD_MISMATCH',
]);
const OBSERVER_ISSUES = new Set<TargetResolutionIssueCode>([
  'MISSING_HOST_OBSERVATION',
  'STALE_HOST_OBSERVATION',
]);
const ACTIVE_ISSUES = new Set<TargetResolutionIssueCode>([
  'MASTERNODE_NOT_ACTIVE',
  'MASTERNODE_HOST_UNRESOLVED',
  'MASTERNODE_HOST_MISMATCH',
  'HOST_HEIGHT_STALE',
]);

function validPercent(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function check(
  id: SimulationPreflightCheckId,
  severity: SimulationPreflightResult['severity'],
  passed: boolean,
  atMs: number,
  passedMessage: string,
  failedMessage: string,
  privateDetail: string | null = null
): SimulationPreflightResult {
  return {
    checkId: id,
    severity,
    passed,
    checkedAtMs: atMs,
    publicMessage: passed ? passedMessage : failedMessage,
    privateDetail: passed ? null : privateDetail,
  };
}

function issueDetails(input: SimulationPreflightInput, codes: ReadonlySet<TargetResolutionIssueCode>): string | null {
  const details = input.targetInventory.issues
    .filter((item) => codes.has(item.code))
    .map((item) => `${item.code}:${item.targetId ?? 'inventory'}:${item.privateDetail}`);
  return details.length === 0 ? null : details.join('; ');
}

function assertInput(input: SimulationPreflightInput): void {
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) throw new Error('preflight time is invalid');
  for (const [name, value] of Object.entries({
    maxExplorerLagBlocks: input.policy.maxExplorerLagBlocks,
    maxExplorerAgeMs: input.policy.maxExplorerAgeMs,
    maxObserverAgeMs: input.policy.maxObserverAgeMs,
    maxTargetSnapshotAgeMs: input.policy.maxTargetSnapshotAgeMs,
    maxStaleTargets: input.policy.maxStaleTargets,
    maxWorkerAgeMs: input.policy.maxWorkerAgeMs,
    expectedQuorumSize: input.policy.expectedQuorumSize,
  })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} is invalid`);
  }
  if (!validPercent(input.policy.minObserverCoveragePercent) || !validPercent(input.observer.coveragePercent)) {
    throw new Error('observer coverage is invalid');
  }
  if (input.policy.expectedQuorumSize < 1) throw new Error('expectedQuorumSize is invalid');
  if (!/^[0-9a-f]{64}$/i.test(input.policy.expectedGenesisHash)) {
    throw new Error('expected genesis hash is invalid');
  }
  if (input.policy.expectedWrapperVersion.trim().length === 0) {
    // A hard precondition, not a target failure: with no expected version there
    // is nothing to hold a target to. Name the knob so the operator can fix it.
    throw new Error('expected wrapper version is not configured; set SIMULATION_EXPECTED_WRAPPER_VERSION');
  }
  if (
    input.observer.staleTargetCount < 0 ||
    !Number.isSafeInteger(input.observer.staleTargetCount) ||
    input.observer.sequenceGapCount < 0 ||
    !Number.isSafeInteger(input.observer.sequenceGapCount) ||
    input.explorer.missingHeights.some((height) => !Number.isSafeInteger(height) || height < 0) ||
    new Set(input.explorer.missingHeights).size !== input.explorer.missingHeights.length
  ) {
    throw new Error('preflight evidence counters are invalid');
  }
  if (new Set(input.selectedTargetIds).size !== input.selectedTargetIds.length) {
    throw new Error('selectedTargetIds must be unique');
  }
  if (input.selectedTargetIds.length > 20) throw new Error('selected target count exceeds the safety limit');
}

/** Pure, fail-closed evaluation. It performs no reads, writes or transitions. */
export function evaluateSimulationPreflight(
  input: SimulationPreflightInput
): SimulationPreflightEvaluation {
  assertInput(input);
  const atMs = input.nowMs;
  const checks: SimulationPreflightResult[] = [];

  const identityPassed =
    input.chain.chain === input.policy.expectedChain &&
    input.chain.genesisHash.toLowerCase() === input.policy.expectedGenesisHash.toLowerCase() &&
    (input.policy.expectedChain === 'regtest' || input.policy.expectedChain.startsWith('devnet-')) &&
    input.targetInventory.network === (input.policy.expectedChain === 'regtest' ? 'regtest' : 'devnet');
  checks.push(check(
    'network-identity', 'required', identityPassed, atMs,
    'Devnet chain identity matches the approved network.',
    'Chain identity does not match the approved devnet.',
    `expected chain=${input.policy.expectedChain} genesis=${input.policy.expectedGenesisHash}; observed chain=${input.chain.chain} genesis=${input.chain.genesisHash}`
  ));

  const chainPassed =
    !input.chain.initialBlockDownload &&
    input.chain.blocks === input.chain.headers &&
    input.chain.blocks === input.targetInventory.capturedAtHeight;
  checks.push(check(
    'chain-synced', 'required', chainPassed, atMs,
    'The reference node is synchronized.', 'The reference node is not synchronized.',
    `blocks=${input.chain.blocks}, headers=${input.chain.headers}, IBD=${input.chain.initialBlockDownload}, snapshot=${input.targetInventory.capturedAtHeight}`
  ));

  const explorerLag = input.chain.blocks - input.explorer.indexedHeight;
  const explorerAge = input.explorer.lastSyncedAtMs === null ? Number.POSITIVE_INFINITY : atMs - input.explorer.lastSyncedAtMs;
  const explorerPassed =
    explorerLag >= 0 &&
    explorerLag <= input.policy.maxExplorerLagBlocks &&
    explorerAge >= 0 &&
    explorerAge <= input.policy.maxExplorerAgeMs &&
    input.explorer.syncError === null &&
    input.explorer.missingHeights.length === 0;
  checks.push(check(
    'explorer-synced', 'required', explorerPassed, atMs,
    'Explorer indexing is current and continuous.', 'Explorer data is incomplete or behind the chain.',
    `lag=${explorerLag}, ageMs=${explorerAge}, error=${input.explorer.syncError ?? 'none'}, missing=${input.explorer.missingHeights.join(',')}`
  ));

  const snapshotsById = new Map(input.targetInventory.snapshots.map((target) => [target.targetId, target]));
  const snapshotAge = atMs - input.targetInventory.capturedAtMs;
  const selectedMissing = input.selectedTargetIds.filter((targetId) => !snapshotsById.has(targetId));
  const mappingIssues = input.targetInventory.issues.filter(
    (item) => !BUILD_ISSUES.has(item.code) && !OBSERVER_ISSUES.has(item.code) && !ACTIVE_ISSUES.has(item.code)
  );
  const mappingPassed =
    input.targetInventory.complete &&
    snapshotAge >= 0 &&
    snapshotAge <= input.policy.maxTargetSnapshotAgeMs &&
    input.selectedTargetIds.length > 0 &&
    selectedMissing.length === 0 &&
    mappingIssues.length === 0;
  checks.push(check(
    'target-resolved', 'required', mappingPassed, atMs,
    'Every selected target has one unambiguous private mapping.',
    'At least one target mapping is missing or ambiguous.',
    [`snapshotAgeMs=${snapshotAge}`, ...mappingIssues.map((item) => `${item.code}:${item.targetId}:${item.privateDetail}`), ...selectedMissing.map((id) => `missing snapshot:${id}`)].join('; ') || null
  ));

  const buildDetail = issueDetails(input, BUILD_ISSUES);
  checks.push(check(
    'target-build-match', 'required', buildDetail === null, atMs,
    'Every target runs the pinned node build.', 'A target build is unknown or does not match.', buildDetail
  ));

  const observerAge = input.observer.lastObservationAtMs === null
    ? Number.POSITIVE_INFINITY
    : atMs - input.observer.lastObservationAtMs;
  const observerDetail = issueDetails(input, OBSERVER_ISSUES);
  const observerPassed =
    observerDetail === null &&
    input.observer.coveragePercent >= input.policy.minObserverCoveragePercent &&
    input.observer.staleTargetCount <= input.policy.maxStaleTargets &&
    observerAge >= 0 &&
    observerAge <= input.policy.maxObserverAgeMs;
  checks.push(check(
    'observer-fresh', 'required', observerPassed, atMs,
    'Observer coverage and freshness meet the required level.',
    'Observer coverage is incomplete or stale.',
    `${observerDetail ?? ''}; coverage=${input.observer.coveragePercent}; stale=${input.observer.staleTargetCount}; ageMs=${observerAge}`
  ));

  const activeDetail = issueDetails(input, ACTIVE_ISSUES);
  checks.push(check(
    'targets-active', 'required', activeDetail === null, atMs,
    'Selected masternodes and hosts are active at the reference height.',
    'A selected masternode or host is not current.', activeDetail
  ));

  const noConflict =
    input.conflicts.otherLiveRunKeys.length === 0 && input.conflicts.otherRunningExperimentKeys.length === 0;
  checks.push(check(
    'no-active-experiment', 'required', noConflict, atMs,
    'No conflicting live simulation or experiment is active.',
    'Another live simulation or experiment is active.',
    `live=${input.conflicts.otherLiveRunKeys.join(',')}; experiments=${input.conflicts.otherRunningExperimentKeys.join(',')}`
  ));

  const recoveryByTarget = new Map(input.recovery.targets.map((target) => [target.targetId, target]));
  const recoveryDuplicates = recoveryByTarget.size !== input.recovery.targets.length;
  const workerAge = input.recovery.workerLastSeenAtMs === null
    ? Number.POSITIVE_INFINITY
    : atMs - input.recovery.workerLastSeenAtMs;
  const badRecovery = input.selectedTargetIds.filter((targetId) => {
    const state = recoveryByTarget.get(targetId);
    return state === undefined ||
      !state.available ||
      !state.faultStateClean ||
      state.wrapperVersion !== input.policy.expectedWrapperVersion;
  });
  const recoveryPassed =
    !input.recovery.required ||
    (!recoveryDuplicates && workerAge >= 0 && workerAge <= input.policy.maxWorkerAgeMs && badRecovery.length === 0);
  checks.push(check(
    'recovery-ready', input.recovery.required ? 'required' : 'warning', recoveryPassed, atMs,
    input.recovery.required
      ? 'Recovery worker and target cleanup mechanisms are ready.'
      : 'Recovery worker is not required for a non-live DryRun.',
    'Recovery cannot be proven for every selected target.',
    `required=${input.recovery.required}; workerAgeMs=${workerAge}; duplicate=${recoveryDuplicates}; targets=${badRecovery.join(',')}`
  ));

  const quorumUnique = new Set(input.quorum.memberTargetIds).size === input.quorum.memberTargetIds.length;
  const quorumMapped = input.quorum.memberTargetIds.every((targetId) => snapshotsById.has(targetId));
  const quorumFresh =
    input.quorum.capturedAtHeight !== null &&
    input.chain.blocks - input.quorum.capturedAtHeight >= 0 &&
    input.chain.blocks - input.quorum.capturedAtHeight <= 1;
  const quorumPassed =
    input.quorum.stable &&
    quorumUnique &&
    quorumMapped &&
    quorumFresh &&
    input.quorum.memberTargetIds.length === input.policy.expectedQuorumSize &&
    (!input.quorum.required || input.selectedTargetIds.every((id) => input.quorum.memberTargetIds.includes(id)));
  checks.push(check(
    'quorum-stable', input.quorum.required ? 'required' : 'warning', quorumPassed, atMs,
    'Current quorum membership is stable and mapped.',
    'Current quorum membership is unavailable, stale or unstable.',
    `required=${input.quorum.required}; stable=${input.quorum.stable}; height=${input.quorum.capturedAtHeight}; members=${input.quorum.memberTargetIds.length}`
  ));

  const baselineEvaluation = input.baseline.evidence === null
    ? { passed: false, reasons: ['baseline evidence is not available'] }
    : baselineEvidenceSatisfies(input.baseline.evidence, input.baseline.plan);
  checks.push(check(
    'baseline-ready', input.baseline.required ? 'required' : 'warning', baselineEvaluation.passed, atMs,
    'Baseline has enough blocks, DKG rounds and ChainLock samples.',
    'Baseline sample is not sufficient yet.', baselineEvaluation.reasons.join('; ')
  ));

  const requiredFailed = checks.some((item) => item.severity === 'required' && !item.passed);
  const warningFailed = checks.some((item) => item.severity === 'warning' && !item.passed);
  const dataQuality: SimulationDataQualitySnapshot = {
    observerCoveragePercent: input.observer.coveragePercent,
    staleTargetCount: input.observer.staleTargetCount,
    explorerLagBlocks: Math.max(0, explorerLag),
    missingHeights: [...input.explorer.missingHeights].sort((a, b) => a - b),
    confidence:
      requiredFailed
        ? 'low'
        : warningFailed || input.observer.sequenceGapCount > 0
          ? 'medium'
          : 'high',
  };
  return { passed: !requiredFailed, checkedAtMs: atMs, checks, dataQuality };
}
