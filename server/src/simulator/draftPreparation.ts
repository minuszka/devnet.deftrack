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
  currentQuorumMemberProTxHashes: readonly string[];
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
    const codes = [...new Set(targetInventory.issues.map((item) => item.code))].join(', ');
    throw new Error(`target inventory is incomplete: ${codes || 'no eligible targets'}`);
  }

  const byProTx = new Map(
    targetInventory.snapshots
      .filter((target) => target.proTxHash !== null)
      .map((target) => [target.proTxHash!.toLowerCase(), target.targetId])
  );
  const seenQuorumHashes = new Set<string>();
  const quorumMemberTargetIds = input.currentQuorumMemberProTxHashes.map((proTxHash) => {
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
    experimentRunKey: input.experimentRunKey ?? null,
    baselineRunKey: input.baselineRunKey ?? null,
    requestedBy: input.requestedBy,
  };
  return { runKey, metadata, targetInventory, dryRunPlan };
}
