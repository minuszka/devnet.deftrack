import { describe, expect, it } from 'vitest';
import {
  SimulationAuditError,
  creationAuditRecord,
  replaySimulationRunAudit,
  simulationFingerprint,
  simulationRunCreationFingerprint,
  simulationRunEventFingerprint,
  transitionAuditRecord,
  type SimulationRunAuditRecord,
} from './simulationAudit.js';
import {
  createSimulationRunState,
  transitionSimulationRun,
  type SimulationRunEvent,
} from './simulationRunState.js';
import type { SimulationRunMetadata } from '../models/SimulationRun.js';

const actor = { actorId: 'admin-1', actorType: 'admin-session' as const, displayName: 'Admin' };
const metadata: SimulationRunMetadata = {
  network: 'devnet',
  scenarioId: 'dry-run-test',
  scenarioVersion: 1,
  parameters: { durationSeconds: 30, nested: { b: 2, a: 1 } },
  seed: 'seed-1',
  targetSnapshot: [],
  experimentRunKey: null,
  baselineRunKey: null,
  requestedBy: actor,
};

describe('simulation audit stream', () => {
  it('hashes objects canonically regardless of object key order', () => {
    expect(simulationFingerprint({ a: 1, b: { x: 2, y: 3 } })).toBe(
      simulationFingerprint({ b: { y: 3, x: 2 }, a: 1 })
    );
  });

  it('rebuilds a run projection from creation and transitions', () => {
    const initial = createSimulationRunState({
      runKey: 'sim-a',
      live: false,
      createdAtMs: 1,
      runExpiresAtMs: 1_000,
    });
    const events: SimulationRunAuditRecord[] = [
      creationAuditRecord({ state: initial, metadata, actor }),
    ];
    const domainEvents: SimulationRunEvent[] = [
      { type: 'begin_preflight', eventId: 'e1', atMs: 2 },
      { type: 'preflight_passed', eventId: 'e2', atMs: 3 },
      { type: 'begin_baseline', eventId: 'e3', atMs: 4 },
      { type: 'baseline_completed', eventId: 'e4', atMs: 5 },
      { type: 'activate_fault', eventId: 'e5', atMs: 6, faultLeaseExpiresAtMs: 900 },
      { type: 'begin_observation', eventId: 'e6', atMs: 7 },
      { type: 'begin_recovery', eventId: 'e7', atMs: 8 },
      { type: 'recovery_succeeded', eventId: 'e8', atMs: 9 },
      { type: 'cooldown_completed', eventId: 'e9', atMs: 10 },
    ];

    let state = initial;
    for (const event of domainEvents) {
      const next = transitionSimulationRun(state, event);
      events.push(
        transitionAuditRecord({
          before: state,
          after: next,
          actor,
          requestFingerprint: simulationRunEventFingerprint(event),
        })
      );
      state = next;
    }

    const replayed = replaySimulationRunAudit(events);
    expect(replayed.state).toEqual(state);
    expect(replayed.state.status).toBe('completed');
    expect(replayed.metadata).toEqual(metadata);
    expect(replayed.metadataFingerprint).toBe(simulationFingerprint(metadata));
    expect(events[0]!.requestFingerprint).toBe(
      simulationRunCreationFingerprint(initial, metadata)
    );
  });

  it('detects a missing audit revision', () => {
    const initial = createSimulationRunState({
      runKey: 'sim-a',
      live: false,
      createdAtMs: 1,
      runExpiresAtMs: 1_000,
    });
    const next = transitionSimulationRun(initial, {
      type: 'begin_preflight',
      eventId: 'e1',
      atMs: 2,
    });
    const later = transitionSimulationRun(next, {
      type: 'preflight_passed',
      eventId: 'e2',
      atMs: 3,
    });
    const events = [
      creationAuditRecord({ state: initial, metadata, actor }),
      transitionAuditRecord({
        before: next,
        after: later,
        actor,
        requestFingerprint: 'fingerprint',
      }),
    ];

    expect(() => replaySimulationRunAudit(events)).toThrowError(
      expect.objectContaining<Partial<SimulationAuditError>>({ code: 'AUDIT_GAP' })
    );
  });

  it('detects a state snapshot that does not match its transition', () => {
    const initial = createSimulationRunState({
      runKey: 'sim-a',
      live: false,
      createdAtMs: 1,
      runExpiresAtMs: 1_000,
    });
    const next = transitionSimulationRun(initial, {
      type: 'begin_preflight',
      eventId: 'e1',
      atMs: 2,
    });
    const transition = transitionAuditRecord({
      before: initial,
      after: next,
      actor,
      requestFingerprint: 'fingerprint',
    });
    transition.toStatus = 'completed';

    expect(() =>
      replaySimulationRunAudit([
        creationAuditRecord({ state: initial, metadata, actor }),
        transition,
      ])
    ).toThrowError(expect.objectContaining<Partial<SimulationAuditError>>({ code: 'AUDIT_DIVERGENCE' }));
  });
});
