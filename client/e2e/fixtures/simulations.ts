/**
 * Public simulation fixtures, shaped exactly like the server's public DTOs.
 *
 * Invented, like every fixture here. Typed against the client's own mirror of
 * the public contract (`src/lib/simulations.ts`), so a field renamed there
 * breaks the typecheck here rather than leaving a fixture the server would
 * never send.
 */
import type {
  PublicSimulationReport,
  PublicSimulationRunView,
  SimulationStatus,
} from '../../src/lib/simulations.js';

export const SIM_A = `sim_${'1'.repeat(32)}`;

export function simRun(
  overrides: { runKey?: string; status?: SimulationStatus; live?: boolean; createdAtMs?: number } = {}
): PublicSimulationRunView {
  return {
    runKey: overrides.runKey ?? SIM_A,
    network: 'regtest',
    scenario: {
      id: 'mn-stop',
      version: 1,
      title: 'Masternode stop',
      riskClass: 'medium',
      parameters: { count: 1, durationSeconds: 60 },
      seed: 'fixture-seed',
    },
    targets: [{ targetId: 'lab-mn-1', displayLabel: 'lab-mn-1', proTxHash: null, role: 'masternode' }],
    state: {
      status: overrides.status ?? 'completed',
      revision: 7,
      live: overrides.live ?? true,
      createdAtMs: overrides.createdAtMs ?? Date.parse('2026-09-11T08:00:00Z'),
      updatedAtMs: Date.parse('2026-09-11T08:30:00Z'),
      stateEnteredAtMs: Date.parse('2026-09-11T08:30:00Z'),
      runExpiresAtMs: Date.parse('2026-09-11T12:00:00Z'),
      faultLeaseExpiresAtMs: null,
      faultMayBeActive: false,
      abortRequested: false,
      lastTransition: null,
    },
    preflight: [],
    dataQuality: { observerCoveragePercent: 100, staleTargetCount: 0, explorerLagBlocks: 0, missingHeights: [], confidence: 'high' },
    experimentRunKey: null,
    baselineRunKey: null,
    createdAt: '2026-09-11T08:00:00.000Z',
    updatedAt: '2026-09-11T08:30:00.000Z',
  };
}

/** A run list of `count`, newest first, with distinct keys. */
export function simRuns(count: number): PublicSimulationRunView[] {
  return Array.from({ length: count }, (_unused, i) =>
    simRun({
      runKey: `sim_${String(i).padStart(32, '0')}`,
      createdAtMs: Date.parse('2026-09-11T08:00:00Z') - i * 60_000,
    })
  );
}

export function simReport(
  overall: 'matched' | 'mismatched' | 'not-evaluable',
  options: { valid?: boolean; success?: boolean; reasons?: string[]; runKey?: string } = {}
): PublicSimulationReport {
  const valid = options.valid ?? overall !== 'not-evaluable';
  const success = options.success ?? (valid && overall === 'matched');
  const row = (actual: 'available' | 'degraded' | 'not-evaluable') => ({
    expected: 'available' as const,
    actual,
    matched: actual === 'not-evaluable' ? null : overall === 'matched',
    reason: actual === 'not-evaluable' ? 'no decided samples in both windows' : '',
  });
  const actual = overall === 'not-evaluable' ? 'not-evaluable' : overall === 'matched' ? 'available' : 'degraded';
  return {
    reportId: 'measure_fixture',
    runKey: options.runKey ?? SIM_A,
    anchor: { faultStartHeight: 11_400, faultStartBlockHash: 'a'.repeat(64), faultEndHeight: 11_406, faultEndBlockHash: 'b'.repeat(64) },
    report: {
      schemaVersion: 1,
      generatedAtMs: Date.parse('2026-09-11T09:00:00Z'),
      windows: {
        baseline: { fromHeight: 11_300, toHeight: 11_399 },
        warmupExcluded: { fromHeight: 11_400, toHeight: 11_402 },
        observation: { fromHeight: 11_403, toHeight: 11_430 },
        cooldownExcluded: { fromHeight: 11_431, toHeight: 11_440 },
      },
      delta: { dkgFormationRate: 0, chainLockCoverage: 0 },
      expectedVsActual: { dkg: row(actual), chainLock: row(actual), dsl: row(actual), overall },
      verdict: { measurementValid: valid, success, reasons: options.reasons ?? [] },
      observation: { dataQuality: { sufficient: valid, confidence: valid ? 'high' : 'low', reasons: valid ? [] : ['pending DKG rounds'] } },
      evidenceFingerprint: 'e'.repeat(64),
      reportFingerprint: 'r'.repeat(64),
    },
  };
}
