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
  /**
   * `observed`: the node listed the quorum after its commitment was mined.
   * `computed`: the members were selected from the cycle base block exactly
   * as the node selects them (`simulator/formingQuorum.ts`), after that
   * selection reproduced the formed quorum named in
   * `verifiedAgainstQuorumHash`. Absent means observed; it is provenance, not
   * identity, so the resolution fingerprint ignores it.
   */
  provenance?: 'observed' | 'computed';
  verifiedAgainstQuorumHash?: string | null;
}

/**
 * The members of `memberProTxHashes` that the frozen target population cannot
 * name unambiguously. Empty means `freezeQuorumTargetSnapshot` will accept the
 * list; the caller can then decide whether a gap is fatal (the current quorum
 * of a quorum scenario) or a reason to record the list as unavailable (the
 * forming quorum, which is evidence rather than a selection input).
 */
export function unresolvableQuorumMembers(
  targets: readonly SimulationTargetSnapshot[],
  memberProTxHashes: readonly string[]
): string[] {
  const mapping = proTxToTargetId(targets);
  return memberProTxHashes
    .map((value) => value.toLowerCase())
    .filter((proTxHash) => !HEX_64.test(proTxHash) || !mapping.has(proTxHash));
}

/**
 * The forming quorum as the frozen target population can carry it. A member
 * outside that population does not block anything -- the forming quorum is
 * evidence, not a selection input -- but it must not be frozen half-mapped
 * either, so the list becomes unavailable with the gap counted in the reason.
 */
export function formingQuorumForTargets(
  targets: readonly SimulationTargetSnapshot[],
  next: QuorumMembershipObservation | null,
  nextUnavailableReason: string | null
): { next: QuorumMembershipObservation | null; nextUnavailableReason: string | null } {
  if (next === null) return { next, nextUnavailableReason };
  const unmapped = unresolvableQuorumMembers(targets, next.memberProTxHashes);
  if (unmapped.length === 0) return { next, nextUnavailableReason: null };
  return {
    next: null,
    nextUnavailableReason:
      `The forming ${next.llmqName} quorum at ${next.expectedHeight} has ${unmapped.length} member(s) ` +
      'outside the registered target population.',
  };
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
  const verifiedAgainstQuorumHash = observation.verifiedAgainstQuorumHash ?? null;
  if (verifiedAgainstQuorumHash !== null && !HEX_64.test(verifiedAgainstQuorumHash)) {
    throw new Error('quorum verification reference is invalid');
  }
  if (observation.provenance === 'computed' && verifiedAgainstQuorumHash === null) {
    throw new Error('a computed quorum membership must name the formed quorum it was verified against');
  }
  return {
    ...identity,
    capturedAtHeight: observation.capturedAtHeight,
    resolutionFingerprint: simulationFingerprint(identity),
    provenance: observation.provenance ?? 'observed',
    verifiedAgainstQuorumHash: verifiedAgainstQuorumHash === null ? null : verifiedAgainstQuorumHash.toLowerCase(),
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

/**
 * Only the canonical identity of the *current* quorum is compared; fields
 * cannot be reordered into a match.
 *
 * The forming quorum is deliberately left out. It is evidence that changes by
 * rule every cycle -- resolved in one cycle, unavailable while the next base
 * block is unmined, resolved again after it -- and no selection input reads it
 * yet, so a run drafted in one cycle and preflighted in the next would fail
 * for a difference it never depended on. The current quorum is what the
 * quorum-member scenario selected from, and that is what must not drift.
 */
export function sameQuorumTargetSnapshot(
  left: SimulationQuorumTargetSnapshot | null,
  right: SimulationQuorumTargetSnapshot | null
): boolean {
  const sameReference = (
    first: SimulationQuorumTargetReference | null,
    second: SimulationQuorumTargetReference | null
  ) => first?.resolutionFingerprint === second?.resolutionFingerprint;
  return left !== null && right !== null ? sameReference(left.current, right.current) : left === right;
}
