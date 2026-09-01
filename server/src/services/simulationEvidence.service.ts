import { chainlockProfileAtHeight } from '../config/llmq.js';
import { config } from '../config.js';
import { medianOf } from '../domain/roundStats.js';
import { simulationFingerprint } from '../domain/simulationAudit.js';
import type { SimulationNetwork } from '../models/SimulationRun.js';
import { Block } from '../models/Block.js';
import { ExperimentRun } from '../models/ExperimentRun.js';
import { HostStatus } from '../models/HostStatus.js';
import { MasternodeEvent } from '../models/MasternodeEvent.js';
import { MasternodeState } from '../models/MasternodeState.js';
import { ObservationGap } from '../models/ObservationGap.js';
import { QuorumRound } from '../models/QuorumRound.js';
import { SimulationRun } from '../models/SimulationRun.js';
import { SimulationTarget } from '../models/SimulationTarget.js';
import { SyncState } from '../models/SyncState.js';
import { prepareSimulationDraft, type PreparedSimulationDraft } from '../simulator/draftPreparation.js';
import { planMeasurementWindowsForLlmqFault } from '../simulator/measurementWindows.js';
import { evaluateSimulationPreflight, type SimulationPreflightEvaluation } from '../simulator/preflight.js';
import type { DryRunPlan } from '../simulator/scenarioTypes.js';
import {
  resolveSimulationTargetInventory,
  type SimulationTargetRegistryRecord,
  type TargetHostEvidence,
  type TargetMasternodeEvidence,
} from '../simulator/targetResolver.js';
import type { SimulationRunProjection } from './simulationPersistence.service.js';
import { rpc, type RpcService } from './rpc.service.js';

const TERMINAL_RUN_STATUSES = ['rejected', 'completed', 'aborted'] as const;
const ESTIMATED_BLOCK_INTERVAL_MS = 150_000;
const OBSERVATION_MAX_AGE_MS = 2 * 60_000;

interface EvidenceSnapshot {
  chain: Awaited<ReturnType<RpcService['getBlockchainInfo']>>;
  genesisHash: string;
  registry: SimulationTargetRegistryRecord[];
  masternodes: TargetMasternodeEvidence[];
  hosts: TargetHostEvidence[];
  quorumMemberProTxHashes: string[];
  quorumStable: boolean;
  quorumProfile: ReturnType<typeof chainlockProfileAtHeight>;
}

export interface SimulationEvidenceProvider {
  prepareDraft(input: {
    idempotencyKey: string;
    network: SimulationNetwork;
    scenario: unknown;
    nowMs: number;
    requestedBy: SimulationRunProjection['metadata']['requestedBy'];
  }): Promise<PreparedSimulationDraft>;
  evaluate(input: {
    run: SimulationRunProjection;
    plan: DryRunPlan;
    nowMs: number;
    baselineRequired: boolean;
  }): Promise<SimulationPreflightEvaluation>;
}

function assertIdentityConfiguration(): void {
  if (
    !/^(regtest|devnet-[A-Za-z0-9._-]+)$/.test(config.simulator.expectedChain) ||
    !/^[0-9a-f]{64}$/i.test(config.simulator.expectedGenesisHash)
  ) {
    throw new Error('simulator chain identity pins are not configured');
  }
}

function maxPlannedOffsetMs(plan: DryRunPlan): number {
  return plan.actions.reduce((maximum, action) => Math.max(
    maximum,
    action.notBeforeOffsetMs,
    action.expiresAfterMs
  ), 0);
}

function snapshotPublicIdentity(value: PreparedSimulationDraft['targetInventory']['snapshots']): unknown {
  return value.map((target) => ({
    targetId: target.targetId,
    operatorId: target.operatorId,
    proTxHash: target.proTxHash,
    hostRef: target.hostRef,
    unitRef: target.unitRef,
    p2pPort: target.p2pPort,
    role: target.role,
    network: target.network,
    expectedBuild: target.expectedBuild,
    capabilities: target.capabilities,
  }));
}

export class MongoRpcSimulationEvidenceService implements SimulationEvidenceProvider {
  constructor(private readonly rpcClient: RpcService = rpc) {}

  private async snapshot(network: SimulationNetwork, nowMs: number): Promise<EvidenceSnapshot> {
    assertIdentityConfiguration();
    const chain = await this.rpcClient.getBlockchainInfo();
    const profile = chainlockProfileAtHeight(chain.blocks);
    const [genesisHash, registryDocs, mnDocs, hostDocs, quorum] = await Promise.all([
      this.rpcClient.getBlockHash(0),
      SimulationTarget.find({ network }).select(
        'targetId displayLabel operatorId proTxHash hostRef unitRef p2pPort role network capabilities expectedBuild enabled maintenance'
      ).lean(),
      MasternodeState.find({ active: true }).select('proTxHash active hostIp').lean(),
      HostStatus.find().select('host height nodeBuild reportedAt').lean(),
      QuorumRound.findOne({ llmqName: profile.llmqName, formed: true, detailsComplete: true })
        .sort({ expectedHeight: -1 })
        .select('members size numValidMembers')
        .lean(),
    ]);
    const registry = registryDocs.map((target) => ({
      targetId: target.targetId,
      displayLabel: target.displayLabel,
      operatorId: target.operatorId,
      proTxHash: target.proTxHash,
      hostRef: target.hostRef,
      unitRef: target.unitRef,
      p2pPort: target.p2pPort,
      role: target.role,
      network: target.network,
      capabilities: [...target.capabilities],
      expectedBuild: target.expectedBuild,
      enabled: target.enabled,
      maintenance: target.maintenance,
    })) as SimulationTargetRegistryRecord[];
    const masternodes = mnDocs.map((mn) => ({
      proTxHash: mn.proTxHash,
      active: mn.active,
      hostRef: mn.hostIp,
    })) as TargetMasternodeEvidence[];
    const hosts = hostDocs.map((host) => ({
      hostRef: host.host,
      reportedAtMs: host.reportedAt.getTime(),
      height: host.height,
      nodeBuild: host.nodeBuild,
    })) as TargetHostEvidence[];
    const quorumMembers = quorum?.members?.map((member) => member.proTxHash) ?? [];
    return {
      chain,
      genesisHash,
      registry,
      masternodes,
      hosts,
      quorumMemberProTxHashes: quorumMembers,
      quorumStable:
        quorum !== null &&
        quorumMembers.length === profile.size &&
        quorum.size === profile.size &&
        quorum.numValidMembers === profile.size,
      quorumProfile: profile,
    };
  }

  async prepareDraft(input: {
    idempotencyKey: string;
    network: SimulationNetwork;
    scenario: unknown;
    nowMs: number;
    requestedBy: SimulationRunProjection['metadata']['requestedBy'];
  }): Promise<PreparedSimulationDraft> {
    const evidence = await this.snapshot(input.network, input.nowMs);
    return prepareSimulationDraft({
      ...input,
      currentHeight: evidence.chain.blocks,
      registry: evidence.registry,
      masternodes: evidence.masternodes,
      hosts: evidence.hosts,
      currentQuorumMemberProTxHashes: evidence.quorumMemberProTxHashes,
    });
  }

  async evaluate(input: {
    run: SimulationRunProjection;
    plan: DryRunPlan;
    nowMs: number;
    baselineRequired: boolean;
  }): Promise<SimulationPreflightEvaluation> {
    const evidence = await this.snapshot(input.run.metadata.network, input.nowMs);
    let inventory = resolveSimulationTargetInventory({
      network: input.run.metadata.network,
      currentHeight: evidence.chain.blocks,
      nowMs: input.nowMs,
      registry: evidence.registry,
      masternodes: evidence.masternodes,
      hosts: evidence.hosts,
    });
    const capturedAtTimes = new Set(input.run.metadata.targetSnapshot.map((target) => target.capturedAtMs));
    const capturedAtHeights = new Set(input.run.metadata.targetSnapshot.map((target) => target.capturedAtHeight));
    if (
      capturedAtTimes.size !== 1 ||
      capturedAtHeights.size !== 1 ||
      simulationFingerprint(snapshotPublicIdentity(inventory.snapshots)) !==
      simulationFingerprint(snapshotPublicIdentity(input.run.metadata.targetSnapshot))
    ) {
      inventory = {
        ...inventory,
        complete: false,
        issues: [...inventory.issues, {
          code: 'INVALID_TARGET_MAPPING',
          targetId: null,
          publicMessage: 'The target mapping changed after draft creation.',
          privateDetail: 'immutable target snapshot fingerprint differs from current registry/evidence',
        }],
      };
    }
    // Current observations detect drift, but they must not make the immutable
    // creation snapshot look newer than it is.
    inventory = {
      ...inventory,
      capturedAtMs: input.run.metadata.targetSnapshot[0]?.capturedAtMs ?? 0,
      capturedAtHeight: input.run.metadata.targetSnapshot[0]?.capturedAtHeight ?? 0,
    };

    const baselineEndHeight = evidence.chain.blocks;
    const faultStartHeight = baselineEndHeight + 1;
    const estimatedFaultBlocks = Math.max(
      1,
      Math.ceil(maxPlannedOffsetMs(input.plan) / ESTIMATED_BLOCK_INTERVAL_MS)
    );
    const measurementPlan = planMeasurementWindowsForLlmqFault({
      primaryLlmqName: evidence.quorumProfile.llmqName,
      faultStartHeight,
      faultEndHeight: faultStartHeight + 2 + estimatedFaultBlocks,
    });
    const selectedTargets = input.run.metadata.targetSnapshot.filter(
      (target) => input.plan.selectedTargetIds.includes(target.targetId)
    );
    const hostByRef = new Map(evidence.hosts.map((host) => [host.hostRef, host]));
    const selectedObservations = selectedTargets
      .map((target) => hostByRef.get(target.hostRef))
      .filter((host): host is TargetHostEvidence => host !== undefined);
    const observationTimes = selectedObservations.map((host) => host.reportedAtMs);
    const staleTargetCount = selectedTargets.filter((target) => {
      const host = hostByRef.get(target.hostRef);
      return host === undefined || input.nowMs - host.reportedAtMs > OBSERVATION_MAX_AGE_MS;
    }).length;

    const [
      sync, indexedHeights, resolvedDkgRounds, baselineFormedRounds, poseRevivedEvents,
      chainLockedBlocks, gapCount, liveConflicts, experiments,
    ] =
      await Promise.all([
        SyncState.findOne({ key: 'blocks' }).select('lastSyncedHeight lastSyncedAt error').lean(),
        Block.find({ height: { $gte: measurementPlan.baseline.fromHeight, $lte: measurementPlan.baseline.toHeight } })
          .select('height').lean(),
        QuorumRound.countDocuments({
          llmqName: evidence.quorumProfile.llmqName,
          expectedHeight: { $gte: measurementPlan.baseline.fromHeight, $lte: measurementPlan.baseline.toHeight },
          status: { $in: ['formed', 'failed', 'impossible'] },
        }),
        // Quiescence evidence: the baseline's own health, and whether the
        // network was recovering inside it. Counting rounds is not enough to
        // establish that a window is a baseline -- see baselineEvidenceSatisfies.
        QuorumRound.find({
          llmqName: evidence.quorumProfile.llmqName,
          expectedHeight: { $gte: measurementPlan.baseline.fromHeight, $lte: measurementPlan.baseline.toHeight },
          status: 'formed',
        }).select('healthRatio').lean(),
        MasternodeEvent.countDocuments({
          type: 'revived',
          height: { $gte: measurementPlan.baseline.fromHeight, $lte: measurementPlan.baseline.toHeight },
        }),
        Block.countDocuments({
          height: { $gte: measurementPlan.baseline.fromHeight, $lte: measurementPlan.baseline.toHeight },
          hasChainLock: true,
        }),
        ObservationGap.countDocuments({
          detectedAt: { $gte: new Date(input.nowMs - OBSERVATION_MAX_AGE_MS) },
        }),
        SimulationRun.find({
          runKey: { $ne: input.run.runKey },
          'state.live': true,
          'state.status': { $nin: TERMINAL_RUN_STATUSES },
        }).select('runKey').lean(),
        ExperimentRun.find({ status: 'running' }).select('runKey').lean(),
      ]);
    const indexedSet = new Set(indexedHeights.map((block) => block.height));
    const missingHeights: number[] = [];
    for (let height = measurementPlan.baseline.fromHeight; height <= measurementPlan.baseline.toHeight; height += 1) {
      if (!indexedSet.has(height)) missingHeights.push(height);
    }
    const targetIdsByProTx = new Map(
      inventory.snapshots
        .filter((target) => target.proTxHash !== null)
        .map((target) => [target.proTxHash!.toLowerCase(), target.targetId])
    );
    const quorumTargetIds = evidence.quorumMemberProTxHashes
      .map((hash) => targetIdsByProTx.get(hash.toLowerCase()))
      .filter((targetId): targetId is string => targetId !== undefined);

    return evaluateSimulationPreflight({
      nowMs: input.nowMs,
      policy: {
        expectedChain: config.simulator.expectedChain,
        expectedGenesisHash: config.simulator.expectedGenesisHash,
        expectedWrapperVersion: config.simulator.expectedWrapperVersion || 'not-installed',
        maxExplorerLagBlocks: 2,
        maxExplorerAgeMs: 2 * 60_000,
        maxObserverAgeMs: OBSERVATION_MAX_AGE_MS,
        maxTargetSnapshotAgeMs: 5 * 60_000,
        minObserverCoveragePercent: 100,
        maxStaleTargets: 0,
        maxWorkerAgeMs: 60_000,
        expectedQuorumSize: evidence.quorumProfile.size,
      },
      chain: {
        chain: evidence.chain.chain,
        genesisHash: evidence.genesisHash,
        blocks: evidence.chain.blocks,
        headers: evidence.chain.headers,
        initialBlockDownload: evidence.chain.initialblockdownload,
      },
      explorer: {
        indexedHeight: sync?.lastSyncedHeight ?? -1,
        lastSyncedAtMs: sync?.lastSyncedAt?.getTime() ?? null,
        syncError: sync === null ? 'sync state is missing' : sync.error,
        missingHeights,
      },
      targetInventory: inventory,
      selectedTargetIds: input.plan.selectedTargetIds,
      observer: {
        coveragePercent: selectedTargets.length === 0
          ? 0
          : (selectedObservations.length / selectedTargets.length) * 100,
        staleTargetCount,
        lastObservationAtMs: observationTimes.length === 0 ? null : Math.min(...observationTimes),
        sequenceGapCount: gapCount,
      },
      conflicts: {
        otherLiveRunKeys: liveConflicts.map((run) => run.runKey),
        otherRunningExperimentKeys: experiments.map((run) => run.runKey),
      },
      recovery: {
        required: input.run.state.live,
        workerLastSeenAtMs: null,
        targets: [],
      },
      quorum: {
        required: input.run.metadata.scenarioId === 'quorum-member-outage',
        stable: evidence.quorumStable,
        capturedAtHeight: evidence.chain.blocks,
        memberTargetIds: quorumTargetIds,
      },
      baseline: {
        required: input.baselineRequired,
        plan: measurementPlan,
        evidence: {
          fromHeight: measurementPlan.baseline.fromHeight,
          toHeight: measurementPlan.baseline.toHeight,
          indexedBlocks: indexedHeights.length,
          resolvedDkgRounds,
          chainLockedBlocks,
          medianHealthRatio: medianOf(
            baselineFormedRounds
              .map((round) => round.healthRatio)
              .filter((value): value is number => typeof value === 'number')
          ),
          poseRevivedEvents,
        },
      },
    });
  }
}
