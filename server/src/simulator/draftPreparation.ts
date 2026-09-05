import { simulationRunKeyFor } from '../domain/simulationIdentity.js';
import type { SimulationAuditActor, SimulationNetwork, SimulationRunMetadata } from '../models/SimulationRun.js';
import { generateDryRunPlan } from './dryRunExecutor.js';
import type { DryRunPlan } from './scenarioTypes.js';
import {
  resolveSimulationTargetInventory,
  type SimulationTargetRegistryRecord,
  type TargetHostEvidence,
  type TargetInventoryResolution,
  type TargetMasternodeEvidence,
  type TargetResolutionPolicy,
} from './targetResolver.js';
import {
  formingQuorumForTargets,
  freezeQuorumTargetSnapshot,
  type QuorumMembershipObservation,
} from './quorumTargetSnapshot.js';

export interface PreparedSimulationDraft {
  runKey: string;
  metadata: SimulationRunMetadata;
  targetInventory: TargetInventoryResolution;
  dryRunPlan: DryRunPlan;
}

/**
 * Resolves and freezes all planning inputs before SimulationRun creation.
 * It is intentionally pure: the caller chooses whether/where to persist the
 * returned metadata after presenting the DryRun to an administrator.
 */
export function prepareSimulationDraft(input: {
  idempotencyKey: string;
  network: SimulationNetwork;
  scenario: unknown;
  currentHeight: number;
  nowMs: number;
  registry: readonly SimulationTargetRegistryRecord[];
  masternodes: readonly TargetMasternodeEvidence[];
  hosts: readonly TargetHostEvidence[];
  targetPolicy?: Partial<TargetResolutionPolicy>;
  /** Identified, authoritative quorum evidence; never a predicted member list. */
  currentQuorum?: QuorumMembershipObservation | null;
  nextQuorum?: QuorumMembershipObservation | null;
  nextQuorumUnavailableReason?: string | null;
  /** Compatibility input for callers that predate identified quorum evidence. */
  currentQuorumMemberProTxHashes: readonly string[];
  /**
   * The signing thresholds of the profile in force at this height.
   *
   * Absent means unknown, and unknown is reported as unknown: a preview that
   * assumed Q60's 44 and 41 measured a devnet that was not there whenever it
   * ran anywhere else, and the lab is exactly anywhere else.
   */
  quorumThresholds?: { dkg: number | null; chainLock: number | null };
  experimentRunKey?: string | null;
  baselineRunKey?: string | null;
  requestedBy: SimulationAuditActor;
}): PreparedSimulationDraft {
  const targetInventory = resolveSimulationTargetInventory({
    network: input.network,
    currentHeight: input.currentHeight,
    nowMs: input.nowMs,
    registry: input.registry,
    masternodes: input.masternodes,
    hosts: input.hosts,
    policy: input.targetPolicy,
  });
  if (!targetInventory.complete) {
    // Named per target, not as a bare list of codes.
    //
    // One unusable target blocks every run, including runs that never reference
    // it -- which is right, since an inventory you cannot trust is not a
    // half-trustworthy inventory. But a message of codes alone does not say WHICH
    // target, so a single retired entry reads as a fault in the targets you did
    // ask for. targetId is safe to name here; hostRef, the private reference, is
    // not, and stays in the issue's privateDetail.
    const byCode = new Map<string, string[]>();
    for (const item of targetInventory.issues) {
      const named = byCode.get(item.code) ?? [];
      if (item.targetId !== null && item.targetId !== undefined) named.push(item.targetId);
      byCode.set(item.code, named);
    }
    const codes = [...byCode.entries()]
      .map(([code, targets]) => (targets.length === 0 ? code : `${code}(${[...new Set(targets)].join(' ')})`))
      .join(', ');
    throw new Error(`target inventory is incomplete: ${codes || 'no eligible targets'}`);
  }

  const byProTx = new Map(
    targetInventory.snapshots
      .filter((target) => target.proTxHash !== null)
      .map((target) => [target.proTxHash!.toLowerCase(), target.targetId])
  );
  // The current quorum must map completely, because a scenario selects from it;
  // a gap there is fatal and named by the resolver below. The forming quorum is
  // evidence only, so a member outside the registered population makes it
  // unavailable -- with the gap recorded -- rather than blocking the draft.
  const forming = formingQuorumForTargets(
    targetInventory.snapshots,
    input.nextQuorum ?? null,
    input.nextQuorumUnavailableReason ?? null
  );
  const quorumTargetSnapshot = input.currentQuorum === undefined && input.nextQuorum === undefined &&
    input.nextQuorumUnavailableReason === undefined
    ? null
    : freezeQuorumTargetSnapshot({
        targets: targetInventory.snapshots,
        current: input.currentQuorum ?? null,
        next: forming.next,
        nextUnavailableReason: forming.nextUnavailableReason,
      });
  const currentQuorumMemberProTxHashes = input.currentQuorum?.memberProTxHashes ?? input.currentQuorumMemberProTxHashes;
  const seenQuorumHashes = new Set<string>();
  const quorumMemberTargetIds = currentQuorumMemberProTxHashes.map((proTxHash) => {
    const key = proTxHash.toLowerCase();
    if (seenQuorumHashes.has(key)) throw new Error('current quorum member list contains duplicates');
    seenQuorumHashes.add(key);
    const targetId = byProTx.get(key);
    if (targetId === undefined) {
      throw new Error(`current quorum member has no unambiguous target mapping: ${proTxHash}`);
    }
    return targetId;
  });

  const runKey = simulationRunKeyFor(input.idempotencyKey);
  const dryRunPlan = generateDryRunPlan(
    { runKey, network: input.network, scenario: input.scenario },
    {
      network: input.network,
      currentHeight: input.currentHeight,
      targets: targetInventory.snapshots,
      quorumMemberTargetIds,
      // The thresholds of the profile actually signing at this height, not
      // Q60's. On the lab they are the test profile's, and pinning Q60's made
      // every lab preview report a margin for a network that was not there.
      quorumThresholds: {
        dkg: input.quorumThresholds?.dkg ?? null,
        chainLock: input.quorumThresholds?.chainLock ?? null,
      },
    }
  );
  const metadata: SimulationRunMetadata = {
    network: input.network,
    scenarioId: dryRunPlan.scenarioId,
    scenarioVersion: dryRunPlan.scenarioVersion,
    parameters: dryRunPlan.parameters,
    seed: dryRunPlan.seed,
    // Full candidate snapshot, not only selected targets: this preserves the
    // deterministic sampling population and partition peer mappings.
    targetSnapshot: targetInventory.snapshots,
    quorumTargetSnapshot,
    experimentRunKey: input.experimentRunKey ?? null,
    baselineRunKey: input.baselineRunKey ?? null,
    requestedBy: input.requestedBy,
  };
  return { runKey, metadata, targetInventory, dryRunPlan };
}
