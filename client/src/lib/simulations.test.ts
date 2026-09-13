import { describe, expect, it } from 'vitest';
import {
  buildSimulationExport,
  readSimulation,
  SIMULATION_EXPORT_SCHEMA_VERSION,
  type PublicSimulationReport,
  type PublicSimulationRunView,
  type SimulationStatus,
} from './simulations.js';

function run(status: SimulationStatus, live = true): PublicSimulationRunView {
  return {
    runKey: `sim_${'a'.repeat(32)}`,
    network: 'regtest',
    scenario: { id: 'mn-stop', version: 1, title: 'Masternode stop', riskClass: 'medium', parameters: { count: 1, durationSeconds: 60 }, seed: 's' },
    targets: [],
    state: {
      status, revision: 3, live, createdAtMs: 1, updatedAtMs: 2, stateEnteredAtMs: 2, runExpiresAtMs: 9,
      faultLeaseExpiresAtMs: null, faultMayBeActive: false, abortRequested: false, lastTransition: null,
    },
    preflight: [],
    dataQuality: null,
    experimentRunKey: null,
    baselineRunKey: null,
    createdAt: null,
    updatedAt: null,
  };
}

function report(
  overall: 'matched' | 'mismatched' | 'not-evaluable',
  measurementValid: boolean,
  success: boolean,
  reasons: string[] = []
): PublicSimulationReport {
  const ea = { expected: 'available' as const, actual: 'available' as const, matched: true, reason: '' };
  return {
    reportId: 'measure_x',
    runKey: `sim_${'a'.repeat(32)}`,
    anchor: { faultStartHeight: 10, faultStartBlockHash: 'a', faultEndHeight: 20, faultEndBlockHash: 'b' },
    report: {
      schemaVersion: 1,
      generatedAtMs: 100,
      windows: {
        baseline: { fromHeight: 1, toHeight: 9 },
        warmupExcluded: { fromHeight: 10, toHeight: 11 },
        observation: { fromHeight: 12, toHeight: 20 },
        cooldownExcluded: { fromHeight: 21, toHeight: 22 },
      },
      delta: {},
      expectedVsActual: { dkg: ea, chainLock: ea, dsl: ea, overall },
      verdict: { measurementValid, success, reasons },
      observation: { dataQuality: { sufficient: measurementValid, confidence: 'high', reasons: [] } },
      evidenceFingerprint: 'e',
      reportFingerprint: 'r',
    },
  };
}

const present = (r: PublicSimulationReport) => ({ kind: 'present' as const, report: r });

describe('reading a simulation run', () => {
  it('does not treat a run that is still going as a result', () => {
    for (const status of ['preflight', 'armed', 'fault_active', 'observing', 'recovery', 'cooldown'] as const) {
      const reading = readSimulation(run(status), { kind: 'absent' });
      expect(reading.kind, status).toBe('in-progress');
      expect(reading.tone, status).not.toBe('good');
    }
  });

  /*
   * The reading most likely to be drawn wrongly: a finished run with no
   * measurement looks, at a glance, like a run that went fine.
   */
  it('reads a completed run with no report as waiting, not passing', () => {
    const reading = readSimulation(run('completed'), { kind: 'absent' });
    expect(reading.kind).toBe('awaiting-measurement');
    expect(reading.tone).toBe('neutral');
    expect(reading.detail).toContain('not a passing one');
  });

  it('keeps a report that could not be read apart from a report that does not exist', () => {
    const unreadable = readSimulation(run('completed'), { kind: 'error', message: 'HTTP 503' });
    const missing = readSimulation(run('completed'), { kind: 'absent' });
    expect(unreadable.kind).toBe('report-unavailable');
    expect(missing.kind).toBe('awaiting-measurement');
    expect(unreadable.label).not.toBe(missing.label);
  });

  it('never calls a not-evaluable measurement a success', () => {
    const reading = readSimulation(run('completed'), present(report('not-evaluable', false, false, ['no decided samples'])));
    expect(reading.kind).toBe('not-evaluable');
    expect(reading.tone).not.toBe('good');
    expect(reading.detail).toContain('no decided samples');
  });

  it('treats an invalid measurement as undecided even if it claims a match', () => {
    const reading = readSimulation(run('completed'), present(report('matched', false, false)));
    expect(reading.kind).toBe('not-evaluable');
  });

  it('reads a live mismatch as a mismatch, with the reasons', () => {
    const reading = readSimulation(run('completed'), present(report('mismatched', true, false, ['chainlock degraded'])));
    expect(reading.kind).toBe('mismatched');
    expect(reading.detail).toContain('chainlock degraded');
  });

  it('reads a valid live match as the only green outcome', () => {
    const reading = readSimulation(run('completed', true), present(report('matched', true, true)));
    expect(reading.kind).toBe('matched');
    expect(reading.tone).toBe('good');
  });

  /*
   * A dry run did nothing to a network, so neither outcome is evidence about
   * one -- a green "matched" would reassure as falsely as a red "mismatched"
   * would alarm.
   */
  it('labels a dry run a dry run, whichever way it came out', () => {
    for (const overall of ['matched', 'mismatched'] as const) {
      const reading = readSimulation(run('completed', false), present(report(overall, true, overall === 'matched')));
      expect(reading.kind, overall).toBe('dry-run');
      expect(reading.tone, overall).toBe('neutral');
      expect(reading.detail, overall).toContain('Nothing was done to a live network');
    }
  });

  it('reads a failed and an aborted run as neither a result nor a pass', () => {
    expect(readSimulation(run('failed'), { kind: 'absent' }).kind).toBe('failed');
    expect(readSimulation(run('aborted'), { kind: 'absent' }).kind).toBe('aborted');
    expect(readSimulation(run('rejected'), { kind: 'absent' }).kind).toBe('rejected');
  });

  it('only ever gives the good tone to a valid live match', () => {
    const statuses: SimulationStatus[] = ['draft', 'preflight', 'rejected', 'scheduled', 'baseline', 'armed',
      'activation_pending', 'fault_active', 'observing', 'aborting', 'recovery', 'cooldown', 'completed', 'aborted', 'failed'];
    const reports = [
      { kind: 'absent' as const },
      { kind: 'error' as const, message: 'x' },
      present(report('not-evaluable', false, false)),
      present(report('mismatched', true, false)),
      present(report('matched', true, true)),
    ];
    for (const status of statuses) {
      for (const live of [true, false]) {
        for (const r of reports) {
          const reading = readSimulation(run(status, live), r);
          const legitimate = status === 'completed' && live && r.kind === 'present' && r.report.report.verdict.success;
          if (reading.tone === 'good') expect(legitimate, `${status}/${live}/${r.kind}`).toBe(true);
        }
      }
    }
  });
});

describe('the export', () => {
  it('carries a schema version, the fetch time and the two public sources', () => {
    const exported = buildSimulationExport(run('completed'), present(report('matched', true, true)), Date.UTC(2026, 8, 12, 9));
    expect(exported.schemaVersion).toBe(SIMULATION_EXPORT_SCHEMA_VERSION);
    expect(exported.fetchedAt).toBe('2026-09-12T09:00:00.000Z');
    expect(exported.source.run).toBe(`/api/v1/simulations/sim_${'a'.repeat(32)}`);
    expect(exported.source.report).toBe(`/api/v1/simulations/sim_${'a'.repeat(32)}/report`);
  });

  it('carries no report rather than an invented one when none exists', () => {
    expect(buildSimulationExport(run('completed'), { kind: 'absent' }, 0).report).toBeNull();
    expect(buildSimulationExport(run('completed'), { kind: 'error', message: 'x' }, 0).report).toBeNull();
  });

  /**
   * V6 of the final review. The two nulls above are different answers, and the
   * file said them identically: an export taken while the report endpoint was
   * failing was byte-for-byte the export of a run nobody had measured, and the
   * envelope documented null as "no measurement exists". The reader of the file
   * could not tell a gap in the record from a gap in the fetch.
   */
  it('says whether the report was read, and a report that could not be read is not one that does not exist', () => {
    const at = Date.UTC(2026, 8, 12, 9);
    const measured = buildSimulationExport(run('completed'), present(report('matched', true, true)), at);
    const absent = buildSimulationExport(run('completed'), { kind: 'absent' }, at);
    const unavailable = buildSimulationExport(run('completed'), { kind: 'error', message: 'HTTP 503' }, at);

    expect(measured.reportRead).toBe('present');
    expect(absent.reportRead).toBe('absent');
    expect(unavailable.reportRead).toBe('unavailable');
    expect(unavailable).not.toEqual(absent);
    // The failure is classified, not quoted: no status line and no server text.
    expect(JSON.stringify(unavailable)).not.toContain('503');
    expect(SIMULATION_EXPORT_SCHEMA_VERSION).toBe(2);
  });

  it('adds nothing to the public responses but the envelope', () => {
    const exported = buildSimulationExport(run('completed'), { kind: 'absent' }, 0);
    expect(Object.keys(exported).sort()).toEqual(['fetchedAt', 'report', 'reportRead', 'run', 'schemaVersion', 'source']);
    expect(exported.run).toEqual(run('completed'));
  });
});
