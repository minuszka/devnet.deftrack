import { describe, expect, it } from 'vitest';
import type { SimulationMeasurementEvidence } from '../simulator/simulationMeasurement.js';
import type { DryRunImpactEstimate } from '../simulator/scenarioTypes.js';
import {
  SimulationMeasurementError,
  SimulationMeasurementService,
  type SimulationMeasurementContext,
  type SimulationMeasurementRecord,
  type SimulationMeasurementRepository,
} from './simulationMeasurement.service.js';

const RUN_KEY = 'sim_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NOW_MS = 3_000_000;
const HOST = 'private-fleet-host';

function impact(): DryRunImpactEstimate {
  return {
    affectedTargetCount: 16,
    affectedMasternodeCount: 16,
    affectedStakerCount: 0,
    affectedHostCount: 2,
    affectedCurrentQuorumMembers: 16,
    currentQuorumSize: 60,
    survivingCurrentQuorumMembers: 44,
    dkgThreshold: 44,
    chainLockThreshold: 41,
    dkgMarginAfterFault: 0,
    chainLockMarginAfterFault: 3,
    warnings: [],
  };
}

function evidence(): SimulationMeasurementEvidence {
  const heights = Array.from({ length: 83 }, (_, index) => 3_928 + index);
  const blocks = heights.map((height) => ({
    height,
    hash: `hash-${height}`,
    time: 1_700_000_000 + height * 150,
    isProofOfStake: true,
    hasChainLock: true,
    chainLockSource: 'zmq' as const,
    chainLockLatencyMs: 1_000,
    chainLockLatencySec: 1,
    firstSeenAtMs: 1_000_000 + height * 1_000,
    stakerScript: 'private-script',
    stakerHostId: HOST,
  }));
  return {
    primaryLlmqName: 'llmq_defcon',
    blocks,
    rounds: [3_928, 3_952, 3_976, 4_004].map((expectedHeight) => ({
      llmqName: 'llmq_defcon',
      dkgInterval: 24,
      expectedHeight,
      status: 'formed' as const,
      healthRatio: 1,
      invalidMembers: [],
    })),
    poseEvents: [],
    dslEpochs: [],
    peerObservations: blocks.flatMap((block) => [
      { hostId: HOST, topic: 'block' as const, hash: block.hash, height: block.height, receivedAtMs: block.firstSeenAtMs, clockOffsetMs: 0, resolutionMs: 0 },
      { hostId: HOST, topic: 'chainlock' as const, hash: block.hash, height: block.height, receivedAtMs: block.firstSeenAtMs + 1_000, clockOffsetMs: 0, resolutionMs: 0 },
    ]),
    observationGaps: [],
    hosts: [{ hostId: HOST, reportedAtMs: NOW_MS - 1_000 }],
    expectedHostIds: [HOST],
    // Far enough past the last in-window round (4004) that every round has left
    // the llmq_defcon re-read band (dkgInterval 24 * signingActiveQuorumCount 2
    // = 48), so finalize's settledness gate passes.
    tipHeight: 4_200,
  };
}

class MemoryMeasurementRepository implements SimulationMeasurementRepository {
  readonly records = new Map<string, SimulationMeasurementRecord>();
  reverse = false;
  context: SimulationMeasurementContext | null = { runKey: RUN_KEY, impact: impact(), expectedHostIds: [HOST] };
  source = evidence();

  async loadContext(): Promise<SimulationMeasurementContext | null> { return this.context; }
  async loadEvidence(): Promise<SimulationMeasurementEvidence> {
    this.reverse = !this.reverse;
    const value = structuredClone(this.source);
    if (this.reverse) {
      value.blocks.reverse();
      value.rounds.reverse();
      value.peerObservations.reverse();
    }
    return value;
  }
  async insertReport(record: SimulationMeasurementRecord): Promise<'inserted' | 'existing'> {
    if (this.records.has(record.reportId)) return 'existing';
    this.records.set(record.reportId, structuredClone(record));
    return 'inserted';
  }
  async findReport(reportId: string): Promise<SimulationMeasurementRecord | null> {
    return this.records.get(reportId) ?? null;
  }
  async findLatestReport(runKey: string): Promise<SimulationMeasurementRecord | null> {
    return [...this.records.values()].find((record) => record.runKey === runKey) ?? null;
  }
}

const anchor = {
  faultStartHeight: 4_000,
  faultStartBlockHash: 'hash-4000',
  faultEndHeight: 4_010,
  faultEndBlockHash: 'hash-4010',
};

describe('SimulationMeasurementService', () => {
  it('persists one immutable report and deterministically verifies reordered evidence', async () => {
    const repository = new MemoryMeasurementRepository();
    const service = new SimulationMeasurementService(repository);
    const first = await service.finalize({ runKey: RUN_KEY, anchor, generatedAtMs: NOW_MS });
    const replay = await service.finalize({ runKey: RUN_KEY, anchor, generatedAtMs: NOW_MS });
    const verification = await service.verify(first.reportId);

    expect(replay).toEqual(first);
    expect(repository.records.size).toBe(1);
    expect(verification.matches).toBe(true);
    expect(first.report.verdict.success).toBe(true);
    expect(JSON.stringify(first.report)).not.toContain(HOST);
  });

  it('fails closed when an immutable fault boundary was reorged or is missing', async () => {
    const repository = new MemoryMeasurementRepository();
    repository.source.blocks.find((block) => block.height === 4_010)!.hash = 'different-hash';
    const service = new SimulationMeasurementService(repository);
    await expect(service.finalize({ runKey: RUN_KEY, anchor, generatedAtMs: NOW_MS }))
      .rejects.toMatchObject({ code: 'CHAIN_REORG' } satisfies Partial<SimulationMeasurementError>);
    expect(repository.records.size).toBe(0);
  });

  it('rejects a duplicate anchor whose stored report differs', async () => {
    const repository = new MemoryMeasurementRepository();
    const service = new SimulationMeasurementService(repository);
    const first = await service.finalize({ runKey: RUN_KEY, anchor, generatedAtMs: NOW_MS });
    repository.source.peerObservations = [];
    await expect(service.finalize({ runKey: RUN_KEY, anchor, generatedAtMs: NOW_MS }))
      .rejects.toMatchObject({ code: 'REPORT_CONFLICT' } satisfies Partial<SimulationMeasurementError>);
    expect(repository.records.get(first.reportId)?.reportFingerprint).toBe(first.reportFingerprint);
  });

  it('refuses to finalize while a round is still in the poller re-read band, and writes nothing', async () => {
    const repository = new MemoryMeasurementRepository();
    // The tip sits just past the last round, so it has not yet left the
    // llmq_defcon re-read band -- its status/health are still being overwritten.
    repository.source.tipHeight = 4_020;
    const service = new SimulationMeasurementService(repository);
    await expect(service.finalize({ runKey: RUN_KEY, anchor, generatedAtMs: NOW_MS }))
      .rejects.toMatchObject({ code: 'EVIDENCE_NOT_SETTLED' } satisfies Partial<SimulationMeasurementError>);
    expect(repository.records.size).toBe(0);
  });

  it('refuses to finalize while an in-window round is still pending', async () => {
    const repository = new MemoryMeasurementRepository();
    repository.source.rounds = repository.source.rounds.map((round, index) =>
      index === 0 ? { ...round, status: 'pending' as const } : round
    );
    const service = new SimulationMeasurementService(repository);
    await expect(service.finalize({ runKey: RUN_KEY, anchor, generatedAtMs: NOW_MS }))
      .rejects.toMatchObject({ code: 'EVIDENCE_NOT_SETTLED' } satisfies Partial<SimulationMeasurementError>);
    expect(repository.records.size).toBe(0);
  });
});
