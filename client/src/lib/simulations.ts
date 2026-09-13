/**
 * The public simulation results: what the page may show, and what it may say
 * about it.
 *
 * Two rules decide almost everything here, and both are about not claiming
 * more than the data holds.
 *
 * **Only what the public API returns.** The types below mirror the server's
 * public allowlist DTOs (`simulationPublicDto.ts`,
 * `simulationMeasurementPublicDto.ts`) field for field. Nothing is filled in
 * from anywhere else, and a field the public contract does not carry is not
 * reconstructed -- a missing value is shown as missing.
 *
 * **A reading is not a verdict it did not earn.** A run that has not been
 * measured is waiting, not passing. A measurement the server calls not
 * evaluable is not a success. A dry run that "matched" proves nothing about a
 * live network, because nothing was done to one. Each of those is a separate
 * state below, with a separate sentence, and none of them may be drawn as the
 * green one.
 */

export type SimulationStatus =
  | 'draft'
  | 'preflight'
  | 'rejected'
  | 'scheduled'
  | 'baseline'
  | 'armed'
  | 'activation_pending'
  | 'fault_active'
  | 'observing'
  | 'aborting'
  | 'recovery'
  | 'cooldown'
  | 'completed'
  | 'aborted'
  | 'failed';

/** GET /api/v1/simulations and /:runKey -- the public run, exactly as served. */
export interface PublicSimulationRunView {
  runKey: string;
  network: 'regtest' | 'devnet';
  scenario: {
    id: string;
    version: number;
    title: string;
    riskClass: 'low' | 'medium' | 'high';
    parameters: Record<string, unknown>;
    seed: string;
  };
  targets: Array<{
    targetId: string;
    displayLabel: string;
    proTxHash: string | null;
    role: 'masternode' | 'staker' | 'seed';
  }>;
  state: {
    status: SimulationStatus;
    revision: number;
    live: boolean;
    createdAtMs: number;
    updatedAtMs: number;
    stateEnteredAtMs: number;
    runExpiresAtMs: number;
    faultLeaseExpiresAtMs: number | null;
    faultMayBeActive: boolean;
    abortRequested: boolean;
    lastTransition: unknown;
  };
  preflight: Array<{
    checkId: string;
    severity: 'required' | 'warning';
    passed: boolean;
    checkedAtMs: number;
    publicMessage: string;
  }>;
  dataQuality: {
    observerCoveragePercent: number;
    staleTargetCount: number;
    explorerLagBlocks: number;
    /** Null on a run recorded before the field existed: not recorded, not "none". */
    missingHeights: number[] | null;
    confidence: 'high' | 'medium' | 'low';
  } | null;
  experimentRunKey: string | null;
  baselineRunKey: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface HeightRange {
  fromHeight: number;
  toHeight: number;
}

export interface ExpectedActual {
  expected: 'available' | 'degraded' | 'unknown';
  actual: 'available' | 'degraded' | 'not-evaluable';
  matched: boolean | null;
  reason: string;
}

/** GET /api/v1/simulations/:runKey/report -- the public aggregate, exactly as served. */
export interface PublicSimulationReport {
  reportId: string;
  runKey: string;
  anchor: {
    faultStartHeight: number;
    faultStartBlockHash: string;
    faultEndHeight: number;
    faultEndBlockHash: string;
  };
  report: {
    schemaVersion: number;
    generatedAtMs: number;
    windows: {
      baseline: HeightRange;
      warmupExcluded: HeightRange;
      observation: HeightRange;
      cooldownExcluded: HeightRange;
    };
    delta: Record<string, number | null>;
    expectedVsActual: {
      dkg: ExpectedActual;
      chainLock: ExpectedActual;
      dsl: ExpectedActual;
      overall: 'matched' | 'mismatched' | 'not-evaluable';
    };
    verdict: { measurementValid: boolean; success: boolean; reasons: string[] };
    observation: { dataQuality: { sufficient: boolean; confidence: string; reasons: string[] } };
    evidenceFingerprint: string;
    reportFingerprint: string;
  };
}

/** What asking for a run's report produced. Absent and failed are not the same. */
export type ReportState =
  | { kind: 'loading' }
  /** The run exists and no measurement has been recorded for it (a 404 on /report). */
  | { kind: 'absent' }
  | { kind: 'present'; report: PublicSimulationReport }
  /** The report could not be read for some other reason. Says nothing about the run. */
  | { kind: 'error'; message: string };

export type ReadingKind =
  | 'not-started'
  | 'rejected'
  | 'in-progress'
  | 'awaiting-measurement'
  | 'matched'
  | 'dry-run'
  | 'mismatched'
  | 'not-evaluable'
  | 'aborted'
  | 'failed'
  | 'report-unavailable';

export interface Reading {
  kind: ReadingKind;
  /** The one-line answer, in words. */
  label: string;
  /** Why this reading and not a better-sounding one. */
  detail: string;
  /** For colour only; the label carries the meaning on its own. */
  tone: 'good' | 'warn' | 'crit' | 'neutral';
}

const IN_PROGRESS: ReadonlySet<SimulationStatus> = new Set([
  'preflight',
  'scheduled',
  'baseline',
  'armed',
  'activation_pending',
  'fault_active',
  'observing',
  'aborting',
  'recovery',
  'cooldown',
]);

/**
 * The reading for one run and whatever its report request produced.
 *
 * Ordered so that the least flattering true statement wins. A completed run
 * with no report is waiting, however long it has been. A measurement that
 * cannot decide is said to be undecided before anything else. And a dry run is
 * labelled a dry run before it is labelled a match or a mismatch.
 */
export function readSimulation(run: PublicSimulationRunView, report: ReportState): Reading {
  const status = run.state.status;
  if (status === 'draft') {
    return { kind: 'not-started', label: 'Not started', detail: 'A draft that was never run.', tone: 'neutral' };
  }
  if (status === 'rejected') {
    return {
      kind: 'rejected',
      label: 'Rejected before it ran',
      detail: 'The run was refused at preflight or approval, so there is nothing to measure.',
      tone: 'neutral',
    };
  }
  if (IN_PROGRESS.has(status)) {
    return {
      kind: 'in-progress',
      label: 'In progress',
      detail: `The run is in ${status}. A result is only computed once it has finished.`,
      tone: 'neutral',
    };
  }
  if (status === 'aborted') {
    return {
      kind: 'aborted',
      label: 'Aborted',
      detail: 'The run was stopped before its planned end. Anything measured covers a shortened window.',
      tone: 'warn',
    };
  }
  if (status === 'failed') {
    return {
      kind: 'failed',
      label: 'Failed',
      detail: 'The run did not complete. A failed run is not a result about the network.',
      tone: 'crit',
    };
  }

  // completed
  if (report.kind === 'loading') {
    return { kind: 'awaiting-measurement', label: 'Loading the measurement…', detail: '', tone: 'neutral' };
  }
  if (report.kind === 'absent') {
    return {
      kind: 'awaiting-measurement',
      label: 'Completed, not yet measured',
      detail: 'No measurement has been recorded for this run. That is a pending result, not a passing one.',
      tone: 'neutral',
    };
  }
  if (report.kind === 'error') {
    return {
      kind: 'report-unavailable',
      label: 'Measurement unavailable',
      detail: `The measurement could not be read: ${report.message}`,
      tone: 'warn',
    };
  }

  const { overall } = report.report.report.expectedVsActual;
  const { measurementValid, success, reasons } = report.report.report.verdict;
  if (overall === 'not-evaluable' || !measurementValid) {
    return {
      kind: 'not-evaluable',
      label: 'Not evaluable',
      detail:
        reasons.length > 0
          ? `The measurement cannot decide: ${reasons.join('; ')}.`
          : 'The measurement cannot decide whether the run matched its expectation.',
      tone: 'warn',
    };
  }
  // A dry run is labelled a dry run before anything else is said about it --
  // matched or not. Nothing was done to a live network, so neither outcome is
  // evidence about one, and a red "did not match" would alarm as falsely as a
  // green "matched" would reassure.
  if (!run.state.live) {
    return {
      kind: 'dry-run',
      label: overall === 'matched' ? 'Dry run — matched the plan' : 'Dry run — did not match the plan',
      detail:
        'Nothing was done to a live network in a dry run. This says whether the plan was self-consistent, not how the network behaved.',
      tone: 'neutral',
    };
  }
  if (overall === 'mismatched') {
    return {
      kind: 'mismatched',
      label: 'Did not match the expectation',
      detail: reasons.length > 0 ? reasons.join('; ') : 'The observed result differs from the dry-run expectation.',
      tone: 'crit',
    };
  }
  if (overall === 'matched' && success) {
    return {
      kind: 'matched',
      label: 'Matched the expectation',
      detail: 'A live run whose measurement was valid and matched what the dry run expected.',
      tone: 'good',
    };
  }
  // A combination the server should not produce: say so rather than guess.
  return {
    kind: 'not-evaluable',
    label: 'Not evaluable',
    detail: 'The measurement does not say both that it is valid and that it matched.',
    tone: 'warn',
  };
}

/* ── export ──────────────────────────────────────────────────────────────── */

/** Bumped when the envelope below changes shape, not when the API's does. */
export const SIMULATION_EXPORT_SCHEMA_VERSION = 1;

export interface SimulationExport {
  schemaVersion: number;
  fetchedAt: string;
  source: { run: string; report: string };
  run: PublicSimulationRunView;
  /** Null when no measurement exists; the export never fills one in. */
  report: PublicSimulationReport | null;
}

/**
 * The downloadable record of one run.
 *
 * Built from the two PUBLIC responses and nothing else. The page never calls
 * an admin endpoint, so there is no history, no artifact and no private
 * evidence available to put in here by accident -- and the envelope names the
 * two public URLs it came from, so a reader of the file can re-fetch and check.
 */
export function buildSimulationExport(
  run: PublicSimulationRunView,
  report: ReportState,
  fetchedAtMs: number
): SimulationExport {
  const base = `/api/v1/simulations/${encodeURIComponent(run.runKey)}`;
  return {
    schemaVersion: SIMULATION_EXPORT_SCHEMA_VERSION,
    fetchedAt: new Date(fetchedAtMs).toISOString(),
    source: { run: base, report: `${base}/report` },
    run,
    report: report.kind === 'present' ? report.report : null,
  };
}

export const RUN_KEY_PATTERN = /^sim_[0-9a-f]{32}$/;
