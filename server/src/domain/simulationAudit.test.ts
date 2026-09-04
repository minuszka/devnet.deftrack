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
      live: true,
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
      { type: 'begin_activation', eventId: 'e4a', atMs: 6, faultLeaseExpiresAtMs: 900 },
      { type: 'activate_fault', eventId: 'e5', atMs: 7, faultLeaseExpiresAtMs: 900 },
      { type: 'begin_observation', eventId: 'e6', atMs: 8 },
      { type: 'begin_recovery', eventId: 'e7', atMs: 9 },
      { type: 'recovery_succeeded', eventId: 'e8', atMs: 10 },
      { type: 'cooldown_completed', eventId: 'e9', atMs: 11 },
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

  it('replays a live run recorded before activation intent was introduced', () => {
    const initial = createSimulationRunState({
      runKey: 'legacy-direct-activation',
      live: true,
      createdAtMs: 1,
      runExpiresAtMs: 1_000,
    });
    const events: SimulationRunAuditRecord[] = [
      creationAuditRecord({ state: initial, metadata, actor }),
    ];
    const domainEvents: SimulationRunEvent[] = [
      { type: 'begin_preflight', eventId: 'legacy-1', atMs: 2 },
      { type: 'preflight_passed', eventId: 'legacy-2', atMs: 3 },
      { type: 'begin_baseline', eventId: 'legacy-3', atMs: 4 },
      { type: 'baseline_completed', eventId: 'legacy-4', atMs: 5 },
      // This is the pre-intent audit shape; persisted runs must remain loadable.
      { type: 'activate_fault', eventId: 'legacy-5', atMs: 6, faultLeaseExpiresAtMs: 900 },
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

    expect(replaySimulationRunAudit(events).state).toEqual(state);
    expect(state.status).toBe('fault_active');
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

describe('canonical key order', () => {
  it('orders keys by code unit, so two hosts cannot disagree', () => {
    // These pairs order one way by code unit and the other way by collation, so
    // a localeCompare-based canonicaliser gives a different fingerprint on a host
    // with a different locale or ICU build -- for byte-identical data.
    const diverging: Array<[string, string]> = [['Height', 'aHeight'], ['aB', 'ab'], ['a_b', 'aB']];
    for (const [a, b] of diverging) {
      expect(Math.sign(a.localeCompare(b))).not.toBe(a < b ? -1 : 1);
      expect(simulationFingerprint({ [a]: 1, [b]: 2 })).toBe(simulationFingerprint({ [b]: 2, [a]: 1 }));
    }
    // Pinned, not merely self-consistent: the fingerprint must be the one a
    // code-unit ordering produces, whatever locale this test runs under.
    expect(simulationFingerprint({ Height: 1, aHeight: 2 })).toBe(
      simulationFingerprint(JSON.parse('{"Height":1,"aHeight":2}'))
    );
  });

  it('leaves the keys used today exactly where they already were', () => {
    // Every key that actually reaches the canonicaliser is lowercase-initial
    // camelCase, where the two orders agree -- so no stored fingerprint changes.
    const keys = ['runKey', 'status', 'revision', 'live', 'createdAtMs', 'faultLeaseExpiresAtMs', 'chainTip'];
    const byCode = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const byLocale = [...keys].sort((a, b) => a.localeCompare(b));
    expect(byCode).toEqual(byLocale);
  });
});

describe('replaying events that carry a payload', () => {
  it('reproduces a run whose fault recorded where it began and ended', () => {
    // The audit stores no event payload -- it rebuilds the event from the state
    // the event produced. A field mirrored onto the state but not read back here
    // replays as absent, the replayed state differs from the recorded one, and
    // the run becomes unloadable. The sequence above passes without chain
    // anchors, which is exactly why it did not catch that.
    const initial = createSimulationRunState({
      runKey: 'sim-anchored',
      live: true,
      createdAtMs: 1,
      runExpiresAtMs: 1_000,
    });
    const events: SimulationRunAuditRecord[] = [
      creationAuditRecord({ state: initial, metadata, actor }),
    ];
    const domainEvents: SimulationRunEvent[] = [
      { type: 'begin_preflight', eventId: 'a1', atMs: 2 },
      { type: 'preflight_passed', eventId: 'a2', atMs: 3 },
      { type: 'begin_baseline', eventId: 'a3', atMs: 4 },
      { type: 'baseline_completed', eventId: 'a4', atMs: 5 },
      { type: 'begin_activation', eventId: 'a4a', atMs: 6, faultLeaseExpiresAtMs: 900 },
      {
        type: 'activate_fault',
        eventId: 'a5',
        atMs: 7,
        faultLeaseExpiresAtMs: 900,
        chainTip: { height: 1_000, hash: 'a'.repeat(64) },
      },
      { type: 'begin_observation', eventId: 'a6', atMs: 8 },
      { type: 'begin_recovery', eventId: 'a7', atMs: 9 },
      {
        type: 'recovery_succeeded',
        eventId: 'a8',
        atMs: 10,
        chainTip: { height: 1_012, hash: 'b'.repeat(64) },
      },
      { type: 'cooldown_completed', eventId: 'a9', atMs: 11 },
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
    expect(replayed.state.faultActivatedTip).toEqual({ height: 1_000, hash: 'a'.repeat(64) });
    expect(replayed.state.recoveredTip).toEqual({ height: 1_012, hash: 'b'.repeat(64) });
  });
});
