import { simulationFingerprint } from '../domain/simulationAudit.js';
import { chainlockProfileNameAtHeight } from '../config/llmq.js';
import type { SimulationMeasurementAnchor } from '../models/SimulationMeasurementReport.js';
import {
  computeSimulationMeasurementReport,
  type SimulationMeasurementEvidence,
  type SimulationMeasurementReport,
} from '../simulator/simulationMeasurement.js';
import { planMeasurementWindowsForLlmqFault } from '../simulator/measurementWindows.js';
import type { DryRunImpactEstimate } from '../simulator/scenarioTypes.js';

export interface SimulationMeasurementContext {
  runKey: string;
  impact: DryRunImpactEstimate;
  /** Private observer identities; never stored in the report. */
  expectedHostIds: string[];
}

export interface SimulationMeasurementRecord {
  reportId: string;
  runKey: string;
  anchor: SimulationMeasurementAnchor;
  evidenceFingerprint: string;
  reportFingerprint: string;
  report: SimulationMeasurementReport;
  generatedAtMs: number;
}

export interface SimulationMeasurementRepository {
  loadContext(runKey: string): Promise<SimulationMeasurementContext | null>;
  loadEvidence(input: {
    fromHeight: number;
    toHeight: number;
    faultStartHeight: number;
    expectedHostIds: readonly string[];
    generatedAtMs: number;
  }): Promise<SimulationMeasurementEvidence>;
  insertReport(record: SimulationMeasurementRecord): Promise<'inserted' | 'existing'>;
  findReport(reportId: string): Promise<SimulationMeasurementRecord | null>;
  findLatestReport(runKey: string): Promise<SimulationMeasurementRecord | null>;
}

export class SimulationMeasurementError extends Error {
  constructor(
    public readonly code:
      | 'RUN_NOT_FOUND'
      | 'INVALID_ANCHOR'
      | 'CHAIN_REORG'
      | 'REPORT_CONFLICT'
      | 'REPORT_NOT_FOUND',
    message: string
  ) {
    super(message);
    this.name = 'SimulationMeasurementError';
  }
}

function assertAnchor(anchor: SimulationMeasurementAnchor): void {
  if (
    !Number.isSafeInteger(anchor.faultStartHeight) ||
    !Number.isSafeInteger(anchor.faultEndHeight) ||
    anchor.faultStartHeight < 1 ||
    anchor.faultEndHeight < anchor.faultStartHeight ||
    anchor.faultStartBlockHash.length === 0 ||
    anchor.faultEndBlockHash.length === 0
  ) {
    throw new SimulationMeasurementError('INVALID_ANCHOR', 'measurement fault anchors are invalid');
  }
}

function blockHashAt(evidence: SimulationMeasurementEvidence, height: number): string | null {
  const matches = evidence.blocks.filter((block) => block.height === height);
  if (matches.length !== 1) return null;
  return matches[0]!.hash;
}

function sameRecord(a: SimulationMeasurementRecord, b: SimulationMeasurementRecord): boolean {
  return (
    a.reportId === b.reportId &&
    a.runKey === b.runKey &&
    a.generatedAtMs === b.generatedAtMs &&
    a.evidenceFingerprint === b.evidenceFingerprint &&
    a.reportFingerprint === b.reportFingerprint &&
    simulationFingerprint(a.anchor) === simulationFingerprint(b.anchor) &&
    simulationFingerprint(a.report) === simulationFingerprint(b.report)
  );
}

export class SimulationMeasurementService {
  constructor(private readonly repository: SimulationMeasurementRepository) {}

  private async compute(input: {
    runKey: string;
    anchor: SimulationMeasurementAnchor;
    generatedAtMs: number;
  }): Promise<SimulationMeasurementRecord> {
    assertAnchor(input.anchor);
    if (!Number.isSafeInteger(input.generatedAtMs) || input.generatedAtMs < 0) {
      throw new SimulationMeasurementError('INVALID_ANCHOR', 'measurement generation time is invalid');
    }
    const context = await this.repository.loadContext(input.runKey);
    if (context === null) {
      throw new SimulationMeasurementError('RUN_NOT_FOUND', 'simulation run or immutable DryRun plan was not found');
    }
    const primaryLlmqName = chainlockProfileNameAtHeight(input.anchor.faultStartHeight);
    const windows = planMeasurementWindowsForLlmqFault({
      primaryLlmqName,
      faultStartHeight: input.anchor.faultStartHeight,
      faultEndHeight: input.anchor.faultEndHeight,
    });
    const evidence = await this.repository.loadEvidence({
      fromHeight: windows.baseline.fromHeight,
      // Include warm-up and both immutable fault boundaries. The pure report
      // still excludes warm-up/cooldown from its statistical snapshots.
      toHeight: input.anchor.faultEndHeight,
      faultStartHeight: input.anchor.faultStartHeight,
      expectedHostIds: context.expectedHostIds,
      generatedAtMs: input.generatedAtMs,
    });
    if (evidence.primaryLlmqName !== primaryLlmqName) {
      throw new SimulationMeasurementError('INVALID_ANCHOR', 'measurement profile does not match the fault-start height');
    }
    if (
      blockHashAt(evidence, input.anchor.faultStartHeight) !== input.anchor.faultStartBlockHash ||
      blockHashAt(evidence, input.anchor.faultEndHeight) !== input.anchor.faultEndBlockHash
    ) {
      throw new SimulationMeasurementError(
        'CHAIN_REORG',
        'fault boundary block hashes changed or are not uniquely indexed'
      );
    }
    const report = computeSimulationMeasurementReport({
      faultStartHeight: input.anchor.faultStartHeight,
      faultEndHeight: input.anchor.faultEndHeight,
      generatedAtMs: input.generatedAtMs,
      impact: context.impact,
      evidence,
    });
    return {
      reportId: `measure_${simulationFingerprint({ runKey: input.runKey, anchor: input.anchor }).slice(0, 40)}`,
      runKey: input.runKey,
      anchor: input.anchor,
      evidenceFingerprint: report.evidenceFingerprint,
      reportFingerprint: report.reportFingerprint,
      report,
      generatedAtMs: input.generatedAtMs,
    };
  }

  /** Internal orchestrator entry point. It is intentionally not an HTTP mutation. */
  async finalize(input: {
    runKey: string;
    anchor: SimulationMeasurementAnchor;
    generatedAtMs: number;
  }): Promise<SimulationMeasurementRecord> {
    const proposed = await this.compute(input);
    const disposition = await this.repository.insertReport(proposed);
    if (disposition === 'inserted') return proposed;
    const existing = await this.repository.findReport(proposed.reportId);
    if (existing === null || !sameRecord(existing, proposed)) {
      throw new SimulationMeasurementError(
        'REPORT_CONFLICT',
        'measurement anchors are already bound to different evidence or output'
      );
    }
    return existing;
  }

  /** Re-queries evidence and proves whether an immutable result is reproducible. */
  async verify(reportId: string): Promise<{
    matches: boolean;
    stored: SimulationMeasurementRecord;
    recomputed: SimulationMeasurementRecord;
  }> {
    const stored = await this.repository.findReport(reportId);
    if (stored === null) {
      throw new SimulationMeasurementError('REPORT_NOT_FOUND', 'measurement report was not found');
    }
    const recomputed = await this.compute({
      runKey: stored.runKey,
      anchor: stored.anchor,
      generatedAtMs: stored.generatedAtMs,
    });
    return { matches: sameRecord(stored, recomputed), stored, recomputed };
  }

  latest(runKey: string): Promise<SimulationMeasurementRecord | null> {
    return this.repository.findLatestReport(runKey);
  }
}
