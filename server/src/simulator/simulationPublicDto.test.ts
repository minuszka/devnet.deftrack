import { describe, expect, it } from 'vitest';
import { createSimulationRunState } from '../domain/simulationRunState.js';
import { PUBLIC_SIMULATION_RUN_PROJECTION, toPublicSimulationRun } from './simulationPublicDto.js';

describe('public simulation projection', () => {
  it('allowlists nested public fields instead of selecting whole private documents', () => {
    const fields = PUBLIC_SIMULATION_RUN_PROJECTION.split(' ');
    expect(fields).not.toContain('metadata');
    expect(fields).not.toContain('preflight');
    for (const forbidden of [
      'metadata.targetSnapshot.hostRef',
      'metadata.targetSnapshot.unitRef',
      'metadata.targetSnapshot.p2pPort',
      'preflight.privateDetail',
      'metadata.requestedBy',
    ]) expect(fields).not.toContain(forbidden);
    expect(fields).toEqual(expect.arrayContaining([
      'metadata.targetSnapshot.targetId',
      'metadata.targetSnapshot.proTxHash',
      'preflight.publicMessage',
    ]));
  });

  it('cannot serialize host/unit/private preflight details even if the source contains them', () => {
    const privateSource = {
      runKey: 'sim_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      metadata: {
        network: 'devnet' as const,
        scenarioId: 'mn-stop',
        scenarioVersion: 1,
        parameters: { count: 1, durationSeconds: 30 },
        seed: 'seed',
        targetSnapshot: [{
          targetId: 'mn-1', displayLabel: 'MN 1', proTxHash: '1'.repeat(64), role: 'masternode' as const,
          hostRef: 'SECRET-HOST', unitRef: 'SECRET-UNIT', p2pPort: 19_799,
        }],
        experimentRunKey: null,
        baselineRunKey: null,
        requestedBy: { actorId: 'SECRET-ACTOR' },
      },
      state: createSimulationRunState({
        runKey: 'sim_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', live: false,
        createdAtMs: 1, runExpiresAtMs: 2,
      }),
      preflight: [{
        checkId: 'target-resolved', severity: 'required' as const, passed: false,
        checkedAtMs: 1, publicMessage: 'Target mapping failed.',
        privateDetail: 'SECRET-HOST/SECRET-UNIT',
      }],
      dataQuality: null,
      createdAt: new Date(1),
      updatedAt: new Date(1),
    };
    const serialized = JSON.stringify(toPublicSimulationRun(privateSource));
    expect(serialized).not.toMatch(/SECRET-HOST|SECRET-UNIT|SECRET-ACTOR|hostRef|unitRef|privateDetail|p2pPort/);
    expect(serialized).toContain('Target mapping failed.');
    expect(serialized).toContain('mn-1');
  });

  it('fails closed when persisted Mixed parameters contain an unknown field', () => {
    const source = {
      runKey: 'sim_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      metadata: {
        network: 'devnet' as const,
        scenarioId: 'mn-stop', scenarioVersion: 1,
        parameters: { count: 1, durationSeconds: 30, hostRef: 'must-not-pass' },
        seed: 'seed', targetSnapshot: [], experimentRunKey: null, baselineRunKey: null,
      },
      state: createSimulationRunState({
        runKey: 'sim_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', live: false,
        createdAtMs: 1, runExpiresAtMs: 2,
      }),
      preflight: [], dataQuality: null,
    };
    expect(() => toPublicSimulationRun(source)).toThrow();
  });
});
