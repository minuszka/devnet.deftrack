import { chainlockProfileAtHeight } from '../config/llmq.js';
import { config } from '../config.js';
import { medianOf } from '../domain/roundStats.js';
import { simulationFingerprint } from '../domain/simulationAudit.js';
import { BLOCK_INTERVAL_MS } from '../domain/dkgWindows.js';
import { TERMINAL_SIMULATION_STATUSES } from '../domain/simulationRunState.js';

/**
 * How far behind the chain the indexer may be and still be trusted.
 *
 * Named once because two places must agree on it: the check that compares
 * heights, and the one that decides whether an unindexed block is a hole or
 * merely the newest one.
 */
const MAX_EXPLORER_LAG_BLOCKS = 2;
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
import { readWrapperHeartbeat, recoveryEvidenceFromHeartbeat } from '../simulator/wrapperHeartbeat.js';
import { resolveFormingQuorum, type FormingQuorumResolution } from '../simulator/formingQuorum.js';
import {
  formingQuorumForTargets,
  freezeQuorumTargetSnapshot,
  sameQuorumTargetSnapshot,
  type QuorumMembershipObservation,
} from '../simulator/quorumTargetSnapshot.js';
import { logger } from '../utils/logger.js';
import type { DryRunPlan } from '../simulator/scenarioTypes.js';
import {
  resolveSimulationTargetInventory,
  type SimulationTargetRegistryRecord,
  type TargetHostEvidence,
  type TargetMasternodeEvidence,
} from '../simulator/targetResolver.js';
import type { SimulationRunProjection } from './simulationPersistence.service.js';
import { rpc, type RpcService } from './rpc.service.js';

// Defined once in the domain: the same list decides which runs hold the live
// slot here and which the /runs?live=true listing reports.
const TERMINAL_RUN_STATUSES = TERMINAL_SIMULATION_STATUSES;

const OBSERVATION_MAX_AGE_MS = 2 * 60_000;

interface EvidenceSnapshot {
  chain: Awaited<ReturnType<RpcService['getBlockchainInfo']>>;
  genesisHash: string;
  registry: SimulationTargetRegistryRecord[];
  masternodes: TargetMasternodeEvidence[];
  hosts: TargetHostEvidence[];
  currentQuorum: QuorumMembershipObservation | null;
  /** The quorum whose DKG is running, resolved from the chain; see `formingQuorum`. */
  nextQuorum: QuorumMembershipObservation | null;
  nextQuorumUnavailableReason: string | null;
  formingQuorum: FormingQuorumResolution;
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
    // Only when the target declares one, so a devnet run's identity hash is
    // byte-identical to one taken before this field existed and no in-flight run
    // reads as drifted across a deploy.
    ...(target.chainHostRef === null || target.chainHostRef === undefined
      ? {}
      : { chainHostRef: target.chainHostRef }),
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
        'targetId displayLabel operatorId proTxHash hostRef chainHostRef unitRef p2pPort role network capabilities expectedBuild enabled maintenance'
      ).lean(),
      MasternodeState.find({ active: true }).select('proTxHash active hostIp').lean(),
      HostStatus.find().select('host height nodeBuild reportedAt').lean(),
      QuorumRound.findOne({ llmqName: profile.llmqName, formed: true, detailsComplete: true })
        .sort({ expectedHeight: -1 })
        .select('llmqType llmqName quorumHash expectedHeight quorumIndex members size numValidMembers')
        .lean(),
    ]);
    const registry = registryDocs.map((target) => ({
      targetId: target.targetId,
      displayLabel: target.displayLabel,
      operatorId: target.operatorId,
      proTxHash: target.proTxHash,
      hostRef: target.hostRef,
      chainHostRef: target.chainHostRef,
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
    const currentQuorum = quorum === null || quorum.quorumHash === null || quorum.members.length === 0
      ? null
      : {
          llmqType: quorum.llmqType,
          llmqName: quorum.llmqName,
          quorumHash: quorum.quorumHash,
          expectedHeight: quorum.expectedHeight,
          quorumIndex: quorum.quorumIndex,
          capturedAtHeight: chain.blocks,
          memberProTxHashes: quorumMembers,
        };
    const formingQuorum = await this.resolveForming(chain, profile, currentQuorum);
    return {
      chain,
      genesisHash,
      registry,
      masternodes,
      hosts,
      currentQuorum,
      nextQuorum: formingQuorum.next,
      nextQuorumUnavailableReason: formingQuorum.nextUnavailableReason,
      formingQuorum,
      quorumMemberProTxHashes: quorumMembers,
      quorumStable:
        currentQuorum !== null &&
        quorumMembers.length === profile.size &&
        quorum?.size === profile.size &&
        quorum?.numValidMembers === profile.size,
      quorumProfile: profile,
    };
  }

  /**
   * The quorum whose DKG is running, from the chain. Every failure here is a
   * reason string on the snapshot, never an exception: the forming quorum is
   * evidence the draft records, not a precondition of it. The self-check
   * outcome is logged either way, because a selection that stops reproducing
   * formed quorums is a finding in its own right -- it would mean the node's
   * rule changed under the explorer.
   */
  private async resolveForming(
    chain: EvidenceSnapshot['chain'],
    profile: ReturnType<typeof chainlockProfileAtHeight>,
    currentQuorum: QuorumMembershipObservation | null
  ): Promise<FormingQuorumResolution> {
    try {
      const resolution = await resolveFormingQuorum({
        tipHeight: chain.blocks,
        profile,
        v20Active: chain.softforks?.v20?.active === true,
        current: currentQuorum === null
          ? null
          : {
              quorumHash: currentQuorum.quorumHash,
              expectedHeight: currentQuorum.expectedHeight,
              memberProTxHashes: currentQuorum.memberProTxHashes,
            },
        source: {
          getBlockHash: (height) => this.rpcClient.getBlockHash(height),
          masternodeListAt: async (height) => {
            const diff = await this.rpcClient.protxSimplifiedListAt(height);
            return diff.mnList.map((entry) => ({
              proTxHash: entry.proRegTxHash,
              confirmedHash: entry.confirmedHash,
              isValid: entry.isValid,
            }));
          },
        },
      });
      if (resolution.selfCheck !== null && !resolution.selfCheck.passed) {
        logger.error(
          `Forming-quorum self-check failed for ${profile.llmqName} at ${resolution.selfCheck.verifiedAgainst.expectedHeight}: ` +
            (resolution.selfCheck.detail ?? 'no detail')
        );
      }
      return resolution;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Forming quorum for ${profile.llmqName} could not be resolved: ${message}`);
      return {
        next: null,
        nextUnavailableReason: `The forming ${profile.llmqName} quorum could not be resolved from the node.`,
        selfCheck: null,
      };
    }
  }

  /**
   * Read-only view for the operator: the forming quorum as the chain defines
   * it, with the self-check it passed, mapped onto the target registry so two
   * observers can compare fingerprints. Member proTxHashes are public chain
   * data; target ids are registry labels, never host addresses.
   */
  async formingQuorum(network: SimulationNetwork, nowMs: number): Promise<{
    tipHeight: number;
    profile: { llmqType: number; llmqName: string; size: number; dkgInterval: number };
    current: QuorumMembershipObservation | null;
    forming: FormingQuorumResolution;
    resolution: ReturnType<typeof freezeQuorumTargetSnapshot> | null;
    resolutionError: string | null;
  }> {
    const evidence = await this.snapshot(network, nowMs);
    let resolution: ReturnType<typeof freezeQuorumTargetSnapshot> | null = null;
    let resolutionError: string | null = null;
    try {
      const inventory = resolveSimulationTargetInventory({
        network,
        currentHeight: evidence.chain.blocks,
        nowMs,
        registry: evidence.registry,
        masternodes: evidence.masternodes,
        hosts: evidence.hosts,
      });
      const forming = formingQuorumForTargets(
        inventory.snapshots,
        evidence.formingQuorum.next,
        evidence.formingQuorum.nextUnavailableReason
      );
      resolution = freezeQuorumTargetSnapshot({
        targets: inventory.snapshots,
        current: evidence.currentQuorum,
        next: forming.next,
        nextUnavailableReason: forming.nextUnavailableReason,
      });
    } catch (error) {
      resolutionError = error instanceof Error ? error.message : String(error);
    }
    return {
      tipHeight: evidence.chain.blocks,
      profile: {
        llmqType: evidence.quorumProfile.llmqType,
        llmqName: evidence.quorumProfile.llmqName,
        size: evidence.quorumProfile.size,
        dkgInterval: evidence.quorumProfile.dkgInterval,
      },
      current: evidence.currentQuorum,
      forming: evidence.formingQuorum,
      resolution,
      resolutionError,
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
      currentQuorum: evidence.currentQuorum,
      nextQuorum: evidence.nextQuorum,
      nextQuorumUnavailableReason: evidence.nextQuorumUnavailableReason,
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

    // Anchored on the height the fault was actually applied at, when the run
    // recorded one. Derived from the live tip it was not a property of the run:
    // the same run measured twice described two different spans of chain, and
    // after the fault ended the window drifted forward with every later block --
    // so a report generated an hour late measured an hour of quiet instead.
    const activatedHeight = input.run.state.faultActivatedTip?.height;
    /*
     * Before activation the window is planned against the INDEXED tip, not the
     * chain tip.
     *
     * A baseline is what can actually be read, and a block the indexer has not
     * reached yet cannot be read. Anchored on the chain tip, the newest block was
     * always missing from its own window -- so `baseline has 71/72 indexed
     * blocks` was reported on a lab whose indexer was working perfectly, one and
     * a half seconds behind a chain that moves every fifteen. Every run was a
     * race, and it was lost often enough to look like a fault in the network.
     *
     * Once the run HAS activated, the recorded height wins outright: where the
     * fault began is a fact about the run, and must not move because the reader
     * is behind.
     */
    const indexedTip = (await SyncState.findOne({ key: 'blocks' }).select('lastSyncedHeight').lean())
      ?.lastSyncedHeight;
    const readableTip = Math.min(evidence.chain.blocks, indexedTip ?? evidence.chain.blocks);
    const faultStartHeight = activatedHeight ?? readableTip + 1;
    const baselineEndHeight = faultStartHeight - 1;
    const estimatedFaultBlocks = Math.max(
      1,
      Math.ceil(maxPlannedOffsetMs(input.plan) / BLOCK_INTERVAL_MS)
    );
    const measurementPlan = planMeasurementWindowsForLlmqFault({
      primaryLlmqName: evidence.quorumProfile.llmqName,
      faultStartHeight,
      // The height recovery was proven at when the run recorded one; otherwise
      // the plan's own estimate, which is what it always used.
      faultEndHeight:
        input.run.state.recoveredTip?.height ?? faultStartHeight + 2 + estimatedFaultBlocks,
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
    /*
     * A hole is reported; a block the indexer has simply not reached yet is not.
     *
     * The baseline window ends at the tip, so ANY indexer lag put the newest
     * block in this list -- and the check that reads it fails on a non-empty
     * list regardless of `maxExplorerLagBlocks`. The two conditions contradicted
     * each other: the policy allowed two blocks of lag and the code made one
     * fatal, so the tolerance was dead and every run was a race against the
     * indexer. On a lab mining every fifteen seconds that race is lost often.
     *
     * "Not yet" and "never" are different findings, and only the second is a
     * defect in the record. A gap anywhere below the tolerated lag is still
     * reported, because that is a hole the indexer has passed over.
     */
    const notYetIndexedFrom = evidence.chain.blocks - MAX_EXPLORER_LAG_BLOCKS;
    const missingHeights: number[] = [];
    for (let height = measurementPlan.baseline.fromHeight; height <= measurementPlan.baseline.toHeight; height += 1) {
      if (!indexedSet.has(height) && height < notYetIndexedFrom) missingHeights.push(height);
    }
    let observedQuorumTargetSnapshot = null;
    try {
      const forming = formingQuorumForTargets(inventory.snapshots, evidence.nextQuorum, evidence.nextQuorumUnavailableReason);
      observedQuorumTargetSnapshot = freezeQuorumTargetSnapshot({
        targets: inventory.snapshots,
        current: evidence.currentQuorum,
        next: forming.next,
        nextUnavailableReason: forming.nextUnavailableReason,
      });
    } catch {
      // Target-resolution preflight exposes the mapping failure with its own
      // safe detail. Do not turn an expected fail-closed result into a 500.
      observedQuorumTargetSnapshot = null;
    }
    const quorumTargetIds = observedQuorumTargetSnapshot?.current?.memberTargetIds ?? [];
    const quorumSnapshotMatches =
      input.run.metadata.quorumTargetSnapshot === null ||
      (observedQuorumTargetSnapshot !== null &&
        sameQuorumTargetSnapshot(input.run.metadata.quorumTargetSnapshot, observedQuorumTargetSnapshot));

    // Only a live run needs recovery evidence, and only a configured lab
    // publishes it; a dry run must not pay a file read for a check it skips.
    const wrapperHeartbeat =
      input.run.state.live && config.simulator.labWrapperHeartbeatPath !== ''
        ? await readWrapperHeartbeat(config.simulator.labWrapperHeartbeatPath)
        : null;

    return evaluateSimulationPreflight({
      nowMs: input.nowMs,
      policy: {
        expectedChain: config.simulator.expectedChain,
        expectedGenesisHash: config.simulator.expectedGenesisHash,
        // Passed straight through, like expectedChain and expectedGenesisHash
        // beside it. The old `|| 'not-installed'` substitution turned an
        // unconfigured server -- an empty env var -- into a sentinel that no
        // real target's wrapper version can equal, so every live preflight
        // failed the recovery check and dead-ended in `rejected`, blaming the
        // targets for a server-side misconfiguration. Unset is now a clear,
        // actionable hard error from evaluateSimulationPreflight instead.
        expectedWrapperVersion: config.simulator.expectedWrapperVersion,
        maxExplorerLagBlocks: MAX_EXPLORER_LAG_BLOCKS,
        maxExplorerAgeMs: 2 * 60_000,
        maxObserverAgeMs: OBSERVATION_MAX_AGE_MS,
        maxTargetSnapshotAgeMs: 5 * 60_000,
        // Two blocks, the same slack the explorer is allowed. Five minutes of
        // snapshot age is roughly two devnet blocks, so the two bounds agree;
        // the block form is the one that matters, because what goes stale is
        // the height the targets were resolved at, not the wall clock.
        maxTargetSnapshotLagBlocks: 2,
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
      // Read from the wrapper's own heartbeat rather than hardcoded. These were
      // `null` and `[]` with `required: live`, which made recovery-ready fail by
      // construction for every live run -- so no live run could be armed at all,
      // and the rejection blamed the targets for a server-side gap.
      recovery: {
        required: input.run.state.live,
        ...recoveryEvidenceFromHeartbeat({
          heartbeat: wrapperHeartbeat,
          targets: input.run.metadata.targetSnapshot,
        }),
      },
      quorum: {
        required: input.run.metadata.scenarioId === 'quorum-member-outage',
        stable: evidence.quorumStable,
        capturedAtHeight: evidence.chain.blocks,
        memberTargetIds: quorumTargetIds,
        snapshotMatches: quorumSnapshotMatches,
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
