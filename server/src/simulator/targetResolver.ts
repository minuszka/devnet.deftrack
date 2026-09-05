import { compareByCodeUnit } from '../domain/codeUnitOrder.js';
import type {
  SimulationNetwork,
  SimulationTargetCapability,
  SimulationTargetRole,
  SimulationTargetSnapshot,
} from '../models/SimulationRun.js';
import { selectSimulationTargets } from './targetSelection.js';

export interface SimulationTargetRegistryRecord {
  targetId: string;
  displayLabel: string;
  operatorId: string | null;
  proTxHash: string | null;
  hostRef: string;
  chainHostRef?: string | null;
  unitRef: string;
  p2pPort: number;
  role: SimulationTargetRole;
  network: SimulationNetwork;
  capabilities: SimulationTargetCapability[];
  expectedBuild: string | null;
  labels: string[];
  enabled: boolean;
  maintenance: boolean;
}

export interface TargetMasternodeEvidence {
  proTxHash: string;
  active: boolean;
  /** Resolved registry reference, never exposed publicly. */
  hostRef: string | null;
}

export interface TargetHostEvidence {
  hostRef: string;
  nodeBuild: string;
  height: number | null;
  reportedAtMs: number;
}

export type TargetResolutionIssueCode =
  | 'DUPLICATE_TARGET_ID'
  | 'DUPLICATE_PROTX_MAPPING'
  | 'DUPLICATE_MASTERNODE_EVIDENCE'
  | 'DUPLICATE_UNIT_MAPPING'
  | 'DUPLICATE_PORT_MAPPING'
  | 'MISSING_PROTX_MAPPING'
  | 'MASTERNODE_NOT_ACTIVE'
  | 'MASTERNODE_HOST_UNRESOLVED'
  | 'MASTERNODE_HOST_MISMATCH'
  | 'MISSING_HOST_OBSERVATION'
  | 'STALE_HOST_OBSERVATION'
  | 'HOST_HEIGHT_STALE'
  | 'EXPECTED_BUILD_MISSING'
  | 'NODE_BUILD_UNKNOWN'
  | 'NODE_BUILD_MISMATCH'
  | 'CAPABILITY_MISSING'
  | 'INVALID_TARGET_MAPPING'
  | 'FLEET_TARGET_LIMIT_EXCEEDED'
  | 'HOST_TARGET_LIMIT_EXCEEDED';

export interface TargetResolutionIssue {
  code: TargetResolutionIssueCode;
  targetId: string | null;
  publicMessage: string;
  privateDetail: string;
}

export interface TargetResolutionPolicy {
  maxHostObservationAgeMs: number;
  maxHostHeightLagBlocks: number;
  requireExpectedBuild: boolean;
  /** Fail closed rather than silently growing the complete declared inventory. */
  maxEnabledTargetsTotal: number;
  /** A single host cannot acquire an unreviewed number of declared services. */
  maxEnabledTargetsPerHost: number;
}

export interface TargetInventoryResolution {
  network: SimulationNetwork;
  capturedAtMs: number;
  capturedAtHeight: number;
  snapshots: SimulationTargetSnapshot[];
  issues: TargetResolutionIssue[];
  complete: boolean;
}

const DEFAULT_POLICY: TargetResolutionPolicy = {
  maxHostObservationAgeMs: 2 * 60_000,
  maxHostHeightLagBlocks: 2,
  requireExpectedBuild: true,
  // This is an inventory limit, not a single-run blast-radius limit. The
  // latter stays MAX_RESOLVED_SELECTION below: the devnet already has more
  // than twenty active masternodes, so using that run limit here made a full,
  // otherwise valid inventory impossible to register.
  maxEnabledTargetsTotal: 250,
  maxEnabledTargetsPerHost: 50,
};

const MAX_RESOLVED_SELECTION = 20;
const HEX_64 = /^[0-9a-f]{64}$/i;

function issue(
  issues: TargetResolutionIssue[],
  code: TargetResolutionIssueCode,
  targetId: string | null,
  publicMessage: string,
  privateDetail: string
): void {
  issues.push({ code, targetId, publicMessage, privateDetail });
}

function duplicates(values: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return repeated;
}

/**
 * Resolves the private inventory into one immutable run snapshot.
 * Disabled and maintenance targets are deliberately not candidates. Any
 * ambiguity among enabled targets is reported and the inventory is incomplete.
 */
export function resolveSimulationTargetInventory(input: {
  network: SimulationNetwork;
  currentHeight: number;
  nowMs: number;
  registry: readonly SimulationTargetRegistryRecord[];
  masternodes: readonly TargetMasternodeEvidence[];
  hosts: readonly TargetHostEvidence[];
  policy?: Partial<TargetResolutionPolicy>;
}): TargetInventoryResolution {
  if (!Number.isSafeInteger(input.nowMs) || !Number.isSafeInteger(input.currentHeight)) {
    throw new Error('target resolution time and height must be safe integers');
  }
  const policy = { ...DEFAULT_POLICY, ...input.policy };
  if (
    policy.maxHostObservationAgeMs < 0 ||
    !Number.isSafeInteger(policy.maxHostObservationAgeMs) ||
    policy.maxHostHeightLagBlocks < 0 ||
    !Number.isSafeInteger(policy.maxHostHeightLagBlocks) ||
    policy.maxEnabledTargetsTotal < 1 ||
    !Number.isSafeInteger(policy.maxEnabledTargetsTotal) ||
    policy.maxEnabledTargetsPerHost < 1 ||
    !Number.isSafeInteger(policy.maxEnabledTargetsPerHost)
  ) {
    throw new Error('target resolution policy is invalid');
  }

  const candidates = input.registry.filter(
    (target) => target.network === input.network && target.enabled && !target.maintenance
  );
  const issues: TargetResolutionIssue[] = [];
  const badTargetIds = new Set<string>();
  const mark = (
    code: TargetResolutionIssueCode,
    targetId: string | null,
    publicMessage: string,
    privateDetail: string
  ) => {
    issue(issues, code, targetId, publicMessage, privateDetail);
    if (targetId !== null) badTargetIds.add(targetId);
  };

  if (candidates.length > policy.maxEnabledTargetsTotal) {
    for (const target of candidates) {
      mark(
        'FLEET_TARGET_LIMIT_EXCEEDED',
        target.targetId,
        'The enabled fleet exceeds the approved target limit.',
        `enabled=${candidates.length}, maximum=${policy.maxEnabledTargetsTotal}`
      );
    }
  }
  const candidatesByHost = new Map<string, SimulationTargetRegistryRecord[]>();
  for (const target of candidates) {
    const hostTargets = candidatesByHost.get(target.hostRef) ?? [];
    hostTargets.push(target);
    candidatesByHost.set(target.hostRef, hostTargets);
  }
  for (const [hostRef, hostTargets] of candidatesByHost) {
    if (hostTargets.length <= policy.maxEnabledTargetsPerHost) continue;
    for (const target of hostTargets) {
      mark(
        'HOST_TARGET_LIMIT_EXCEEDED',
        target.targetId,
        'A host exceeds the approved target limit.',
        `host=${hostRef}, enabled=${hostTargets.length}, maximum=${policy.maxEnabledTargetsPerHost}`
      );
    }
  }

  for (const targetId of duplicates(candidates.map((target) => target.targetId))) {
    mark('DUPLICATE_TARGET_ID', targetId, 'A target mapping is ambiguous.', `duplicate targetId ${targetId}`);
  }
  for (const mapping of duplicates(candidates.map((target) => `${target.hostRef}\u0000${target.unitRef}`))) {
    const conflicting = candidates.filter((target) => `${target.hostRef}\u0000${target.unitRef}` === mapping);
    for (const target of conflicting) {
      mark(
        'DUPLICATE_UNIT_MAPPING', target.targetId, 'A service mapping is ambiguous.',
        `host/unit is shared by ${conflicting.map((item) => item.targetId).join(', ')}`
      );
    }
  }
  for (const mapping of duplicates(candidates.map((target) => `${target.hostRef}\u0000${target.p2pPort}`))) {
    const conflicting = candidates.filter((target) => `${target.hostRef}\u0000${target.p2pPort}` === mapping);
    for (const target of conflicting) {
      mark(
        'DUPLICATE_PORT_MAPPING', target.targetId, 'A P2P port mapping is ambiguous.',
        `host/port is shared by ${conflicting.map((item) => item.targetId).join(', ')}`
      );
    }
  }

  const proTxOwners = new Map<string, SimulationTargetRegistryRecord[]>();
  for (const target of candidates) {
    if (target.proTxHash === null) continue;
    const key = target.proTxHash.toLowerCase();
    const owners = proTxOwners.get(key) ?? [];
    owners.push(target);
    proTxOwners.set(key, owners);
  }
  for (const owners of proTxOwners.values()) {
    if (owners.length < 2) continue;
    for (const target of owners) {
      mark(
        'DUPLICATE_PROTX_MAPPING', target.targetId, 'A masternode mapping is ambiguous.',
        `proTxHash is shared by ${owners.map((item) => item.targetId).join(', ')}`
      );
    }
  }

  const duplicateMnEvidence = duplicates(input.masternodes.map((mn) => mn.proTxHash.toLowerCase()));
  const mnByProTx = new Map(input.masternodes.map((mn) => [mn.proTxHash.toLowerCase(), mn]));
  for (const proTxHash of duplicateMnEvidence) {
    for (const target of candidates.filter((item) => item.proTxHash?.toLowerCase() === proTxHash)) {
      mark(
        'DUPLICATE_MASTERNODE_EVIDENCE', target.targetId, 'Masternode evidence is ambiguous.',
        `multiple active-state rows for ${target.proTxHash}`
      );
    }
  }
  const hostsByRef = new Map(input.hosts.map((host) => [host.hostRef, host]));
  if (hostsByRef.size !== input.hosts.length) {
    for (const hostRef of duplicates(input.hosts.map((host) => host.hostRef))) {
      for (const target of candidates.filter((item) => item.hostRef === hostRef)) {
        mark('MISSING_HOST_OBSERVATION', target.targetId, 'Host telemetry is ambiguous.', `duplicate host observation ${hostRef}`);
      }
    }
  }

  for (const target of candidates) {
    if (
      target.targetId.trim().length === 0 ||
      target.hostRef.trim().length === 0 ||
      target.unitRef.trim().length === 0 ||
      !Number.isSafeInteger(target.p2pPort) ||
      target.p2pPort < 1 ||
      target.p2pPort > 65_535
    ) {
      mark('INVALID_TARGET_MAPPING', target.targetId || null, 'Target mapping is invalid.', 'empty identity/host/unit or invalid P2P port');
    }
    if (target.capabilities.length === 0 || new Set(target.capabilities).size !== target.capabilities.length) {
      mark('CAPABILITY_MISSING', target.targetId, 'Target capabilities are incomplete.', 'capability list is empty or duplicated');
    }
    if (target.role === 'masternode') {
      if (target.proTxHash === null || !HEX_64.test(target.proTxHash)) {
        mark('MISSING_PROTX_MAPPING', target.targetId, 'Masternode identity is missing.', 'no proTxHash in target registry');
      } else {
        const mn = mnByProTx.get(target.proTxHash.toLowerCase());
        if (mn === undefined || !mn.active) {
          mark('MASTERNODE_NOT_ACTIVE', target.targetId, 'Masternode is not active.', `active proTx entry missing for ${target.proTxHash}`);
        } else if (mn.hostRef === null) {
          mark(
            'MASTERNODE_HOST_UNRESOLVED', target.targetId, 'Masternode host identity is unknown.',
            `observed hostRef is null for ${target.proTxHash}`
          );
        } else if (mn.hostRef !== (target.chainHostRef ?? target.hostRef)) {
          // Compared against the host the CHAIN sees, which is hostRef itself
          // unless the target declared them apart. See SimulationTarget.
          const declared = target.chainHostRef ?? target.hostRef;
          mark(
            'MASTERNODE_HOST_MISMATCH', target.targetId, 'Masternode host mapping changed.',
            `registry=${declared}, observed=${mn.hostRef}`
          );
        }
      }
    }

    const host = hostsByRef.get(target.hostRef);
    if (host === undefined) {
      mark('MISSING_HOST_OBSERVATION', target.targetId, 'Host telemetry is unavailable.', `no HostStatus for ${target.hostRef}`);
    } else {
      const ageMs = input.nowMs - host.reportedAtMs;
      // Only "too old" is stale. A negative age means the host reported AFTER the
      // reference instant -- fresher than the reference, not staler -- and reading
      // it as stale is how a replayed request came to blame the fleet for a clock
      // it had frozen itself.
      if (ageMs > policy.maxHostObservationAgeMs) {
        mark('STALE_HOST_OBSERVATION', target.targetId, 'Host telemetry is stale.', `host observation age=${ageMs}ms`);
      }
      if (host.height === null || input.currentHeight - host.height > policy.maxHostHeightLagBlocks || host.height > input.currentHeight) {
        mark('HOST_HEIGHT_STALE', target.targetId, 'Host chain height is not current.', `tip=${input.currentHeight}, host=${host.height}`);
      }
      if (target.expectedBuild === null || !HEX_64.test(target.expectedBuild)) {
        if (policy.requireExpectedBuild) {
          mark('EXPECTED_BUILD_MISSING', target.targetId, 'Expected node build is not pinned.', 'target expectedBuild is empty');
        }
      } else if (host.nodeBuild.length === 0) {
        mark('NODE_BUILD_UNKNOWN', target.targetId, 'Running node build is unknown.', `host ${target.hostRef} reported no build hash`);
      } else if (host.nodeBuild.toLowerCase() !== target.expectedBuild.toLowerCase()) {
        mark(
          'NODE_BUILD_MISMATCH', target.targetId, 'Running node build does not match the approved build.',
          `expected=${target.expectedBuild}, observed=${host.nodeBuild}`
        );
      }
    }
  }

  const snapshots = candidates
    .filter((target) => !badTargetIds.has(target.targetId))
    .map<SimulationTargetSnapshot>((target) => ({
      targetId: target.targetId,
      displayLabel: target.displayLabel,
      operatorId: target.operatorId,
      proTxHash: target.proTxHash,
      hostRef: target.hostRef,
      // Carried only when declared: absent means "the same as hostRef", which is
      // every devnet target, and an absent key is dropped by canonicalJson.
      ...(target.chainHostRef === null || target.chainHostRef === undefined
        ? {}
        : { chainHostRef: target.chainHostRef }),
      unitRef: target.unitRef,
      p2pPort: target.p2pPort,
      role: target.role,
      network: target.network,
      capabilities: [...target.capabilities].sort(),
      expectedBuild: target.expectedBuild,
      capturedAtMs: input.nowMs,
      capturedAtHeight: input.currentHeight,
    }))
    .sort((a, b) => compareByCodeUnit(a.targetId, b.targetId));

  return {
    network: input.network,
    capturedAtMs: input.nowMs,
    capturedAtHeight: input.currentHeight,
    snapshots,
    issues: issues.sort((a, b) => compareByCodeUnit(a.targetId ?? '', b.targetId ?? '') || compareByCodeUnit(a.code, b.code)),
    complete: issues.length === 0 && snapshots.length > 0,
  };
}

export type ResolvedTargetSelector =
  | {
      mode: 'random';
      role: SimulationTargetRole;
      capability: SimulationTargetCapability;
      count: number;
      seed: string;
    }
  | { mode: 'host'; anchorTargetId: string; capability?: SimulationTargetCapability }
  | { mode: 'operator'; operatorId: string; capability?: SimulationTargetCapability }
  | {
      mode: 'quorum';
      quorumMemberProTxHashes: readonly string[];
      capability: SimulationTargetCapability;
      count: number;
      seed: string;
    };

/** Selects only from an already complete immutable inventory. */
export function selectResolvedSimulationTargets(
  inventory: TargetInventoryResolution,
  selector: ResolvedTargetSelector
): SimulationTargetSnapshot[] {
  if (!inventory.complete) throw new Error('target inventory is incomplete');
  const targets = inventory.snapshots;
  const bounded = (selected: SimulationTargetSnapshot[]): SimulationTargetSnapshot[] => {
    if (selected.length > MAX_RESOLVED_SELECTION) {
      throw new Error(`resolved selection exceeds ${MAX_RESOLVED_SELECTION} targets`);
    }
    return selected;
  };
  switch (selector.mode) {
    case 'random':
      if (selector.count > MAX_RESOLVED_SELECTION) throw new Error('resolved selection is too large');
      return selectSimulationTargets({
        candidates: targets.filter(
          (target) => target.role === selector.role && target.capabilities.includes(selector.capability)
        ),
        count: selector.count,
        seed: selector.seed,
        namespace: `resolved:random:${selector.role}:${selector.capability}`,
      });
    case 'host': {
      const anchor = targets.find((target) => target.targetId === selector.anchorTargetId);
      if (anchor === undefined) throw new Error('host selector anchor is not resolved');
      const selected = targets.filter(
        (target) =>
          target.hostRef === anchor.hostRef &&
          (selector.capability === undefined || target.capabilities.includes(selector.capability))
      );
      if (selected.length === 0) throw new Error('host selector has no eligible targets');
      return bounded(selected);
    }
    case 'operator': {
      const selected = targets.filter(
        (target) =>
          target.operatorId === selector.operatorId &&
          (selector.capability === undefined || target.capabilities.includes(selector.capability))
      );
      if (selected.length === 0) throw new Error('operator selector has no eligible targets');
      return bounded(selected);
    }
    case 'quorum': {
      if (selector.count > MAX_RESOLVED_SELECTION) throw new Error('resolved selection is too large');
      const proTxSet = new Set(selector.quorumMemberProTxHashes.map((hash) => hash.toLowerCase()));
      if (proTxSet.size !== selector.quorumMemberProTxHashes.length) {
        throw new Error('quorum member list must be unique');
      }
      return selectSimulationTargets({
        candidates: targets.filter(
          (target) =>
            target.proTxHash !== null &&
            proTxSet.has(target.proTxHash.toLowerCase()) &&
            target.capabilities.includes(selector.capability)
        ),
        count: selector.count,
        seed: selector.seed,
        namespace: 'resolved:quorum',
      });
    }
  }
}
