import { simulationFingerprint } from '../domain/simulationAudit.js';
import type {
  SimulationQuorumTargetReference,
  SimulationQuorumTargetSnapshot,
  SimulationTargetSnapshot,
} from '../models/SimulationRun.js';

const HEX_64 = /^[0-9a-f]{64}$/i;

/**
 * A membership list that was observed from a specific, already-formed quorum.
 *
 * It deliberately has no prediction fields. A future quorum may be scheduled,
 * but its members must remain unavailable until an authoritative observer has
 * supplied its quorum hash and full member list.
 */
export interface QuorumMembershipObservation {
  llmqType: number;
  llmqName: string;
  quorumHash: string;
  expectedHeight: number;
  quorumIndex: number;
  capturedAtHeight: number;
  memberProTxHashes: readonly string[];
}

function assertReference(observation: QuorumMembershipObservation): void {
  if (
    !Number.isSafeInteger(observation.llmqType) ||
    !Number.isSafeInteger(observation.expectedHeight) || observation.expectedHeight < 0 ||
    !Number.isSafeInteger(observation.quorumIndex) || observation.quorumIndex < 0 ||
    !Number.isSafeInteger(observation.capturedAtHeight) || observation.capturedAtHeight < 0 ||
    observation.llmqName.trim().length === 0 ||
    !HEX_64.test(observation.quorumHash)
  ) {
    throw new Error('quorum observation identity is invalid');
  }
  if (observation.memberProTxHashes.length === 0) {
    throw new Error('quorum observation has no members');
  }
}

function proTxToTargetId(targets: readonly SimulationTargetSnapshot[]): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const target of targets) {
    if (target.role !== 'masternode') continue;
    if (target.proTxHash === null || !HEX_64.test(target.proTxHash)) continue;
    const proTxHash = target.proTxHash.toLowerCase();
    if (mapping.has(proTxHash)) {
      throw new Error(`quorum target mapping is ambiguous: ${proTxHash}`);
    }
    mapping.set(proTxHash, target.targetId);
  }
  return mapping;
}

function resolveReference(
  observation: QuorumMembershipObservation,
  mapping: ReadonlyMap<string, string>
): SimulationQuorumTargetReference {
  assertReference(observation);
  const memberProTxHashes = observation.memberProTxHashes.map((value) => {
    if (!HEX_64.test(value)) throw new Error(`quorum member proTxHash is invalid: ${value}`);
    return value.toLowerCase();
  }).sort();
  if (new Set(memberProTxHashes).size !== memberProTxHashes.length) {
    throw new Error('quorum member list contains duplicates');
  }
  const memberTargetIds = memberProTxHashes.map((proTxHash) => {
    const targetId = mapping.get(proTxHash);
    if (targetId === undefined) {
      throw new Error(`quorum member has no unambiguous target mapping: ${proTxHash}`);
    }
    return targetId;
  }).sort();
  if (new Set(memberTargetIds).size !== memberTargetIds.length) {
    throw new Error('quorum member target mapping is ambiguous');
  }
  // `capturedAtHeight` is evidence freshness, not quorum identity. Two
  // observers on adjacent tips that describe the same formed quorum must
  // therefore produce the same resolution fingerprint.
  const identity = {
    llmqType: observation.llmqType,
    llmqName: observation.llmqName,
    quorumHash: observation.quorumHash.toLowerCase(),
    expectedHeight: observation.expectedHeight,
    quorumIndex: observation.quorumIndex,
    memberProTxHashes,
    memberTargetIds,
  };
  return {
    ...identity,
    capturedAtHeight: observation.capturedAtHeight,
    resolutionFingerprint: simulationFingerprint(identity),
  };
}

/**
 * Resolves quorum members only through the frozen target population. Sorting
 * identities before mapping makes independent observers converge even when the
 * RPC returned the same member list in a different order.
 */
export function freezeQuorumTargetSnapshot(input: {
  targets: readonly SimulationTargetSnapshot[];
  current: QuorumMembershipObservation | null;
  next?: QuorumMembershipObservation | null;
  nextUnavailableReason?: string | null;
}): SimulationQuorumTargetSnapshot {
  const next = input.next ?? null;
  const nextUnavailableReason = input.nextUnavailableReason ?? null;
  if (next !== null && nextUnavailableReason !== null) {
    throw new Error('next quorum cannot be both resolved and unavailable');
  }
  if (nextUnavailableReason !== null && nextUnavailableReason.trim().length === 0) {
    throw new Error('next quorum unavailable reason is empty');
  }
  const mapping = proTxToTargetId(input.targets);
  return {
    current: input.current === null ? null : resolveReference(input.current, mapping),
    next: next === null ? null : resolveReference(next, mapping),
    nextUnavailableReason,
  };
}

/** Only the canonical identity is compared; fields cannot be reordered into a match. */
export function sameQuorumTargetSnapshot(
  left: SimulationQuorumTargetSnapshot | null,
  right: SimulationQuorumTargetSnapshot | null
): boolean {
  const sameReference = (
    first: SimulationQuorumTargetReference | null,
    second: SimulationQuorumTargetReference | null
  ) => first?.resolutionFingerprint === second?.resolutionFingerprint;
  return (
    left !== null && right !== null
      ? sameReference(left.current, right.current) &&
        sameReference(left.next, right.next) &&
        left.nextUnavailableReason === right.nextUnavailableReason
      : left === right
  );
}
