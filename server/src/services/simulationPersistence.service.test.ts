import { describe, expect, it } from 'vitest';
import type { SimulationRunAuditRecord } from '../domain/simulationAudit.js';
import { replaySimulationRunAudit, simulationRunEventFingerprint, transitionAuditRecord } from '../domain/simulationAudit.js';
import { transitionSimulationRun, type SimulationRunState } from '../domain/simulationRunState.js';
import { simulationRunKeyFor } from '../domain/simulationIdentity.js';
import type { SimulationRecoveryResult, SimulationRunMetadata } from '../models/SimulationRun.js';
import type { DryRunPlan } from '../simulator/scenarioTypes.js';
import {
  SimulationPersistenceService,
  type AppendSimulationAuditResult,
  type SimulationPersistenceRepository,
  type SimulationRunProjection,
} from './simulationPersistence.service.js';

const actor = { actorId: 'admin-1', actorType: 'admin-session' as const, displayName: 'Admin' };
const systemActor = { actorId: 'scheduler', actorType: 'system' as const, displayName: null };

const metadata = (scenarioId = 'dry-run'): SimulationRunMetadata => ({
  network: 'devnet',
  scenarioId,
  scenarioVersion: 1,
  parameters: { durationSeconds: 30 },
  seed: 'seed-1',
  targetSnapshot: [],
  experimentRunKey: null,
  baselineRunKey: null,
  requestedBy: actor,
});

const clone = <T>(value: T): T => structuredClone(value);

function plan(idempotencyKey: string, scenarioId = 'dry-run', faultLeaseSeconds = 30): DryRunPlan {
  const runKey = simulationRunKeyFor(idempotencyKey);
  return {
    mode: 'dry-run',
    runKey,
    network: 'devnet',
    scenarioId: scenarioId as DryRunPlan['scenarioId'],
    scenarioVersion: 1,
    seed: 'seed-1',
    parameters: { durationSeconds: 30 },
    selectedTargetIds: ['mn-1'],
    selectedRoles: ['masternode'],
    actions: [{
      actionId: 'act-test',
      runKey,
      sequence: 0,
      targetId: 'mn-1',
      kind: 'service-stop',
      payload: { kind: 'service-stop', faultLeaseSeconds },
      payloadDigest: 'digest',
      notBeforeOffsetMs: 0,
      expiresAfterMs: 120_000,
      maxAttempts: 3,
    }],
    impact: {
      affectedTargetCount: 1,
      affectedMasternodeCount: 1,
      affectedStakerCount: 0,
      affectedHostCount: 1,
      affectedCurrentQuorumMembers: 0,
      currentQuorumSize: null,
      survivingCurrentQuorumMembers: null,
      dkgThreshold: 44,
      chainLockThreshold: 41,
      dkgMarginAfterFault: null,
      chainLockMarginAfterFault: null,
      warnings: [],
    },
    coreSimulator: {
      status: 'not-modeled',
      repository: 'test',
      profile: 'q60_44_41',
      scenarioFamilies: [],
      artifacts: [],
      note: 'test',
    },
    planFingerprint: 'plan-fingerprint',
    assurances: ['NO_DATABASE_WRITE', 'NO_RPC_CALL', 'NO_REMOTE_ACTION', 'NO_FAULT_APPLIED'],
  };
}

class MemorySimulationRepository implements SimulationPersistenceRepository {
  readonly runs = new Map<string, SimulationRunProjection>();
  readonly audits = new Map<string, SimulationRunAuditRecord[]>();
  readonly recoveries = new Map<string, SimulationRecoveryResult>();
  failNextCas = false;

  async findRun(runKey: string): Promise<SimulationRunProjection | null> {
    const found = this.runs.get(runKey);
    return found === undefined ? null : clone(found);
  }

  async insertRun(projection: SimulationRunProjection): Promise<'inserted' | 'existing'> {
    if (this.runs.has(projection.runKey)) return 'existing';
    this.runs.set(projection.runKey, clone(projection));
    return 'inserted';
  }

  async compareAndSwapRun(
    runKey: string,
    expectedRevision: number,
    nextState: SimulationRunState,
    recovery?: SimulationRecoveryResult
  ): Promise<boolean> {
    if (this.failNextCas) {
      this.failNextCas = false;
      return false;
    }
    const current = this.runs.get(runKey);
    if (current === undefined || current.state.revision !== expectedRevision) return false;
    this.runs.set(runKey, { ...current, state: clone(nextState) });
    if (recovery !== undefined) this.recoveries.set(runKey, clone(recovery));
    return true;
  }

  async writeRecoveryForEvent(runKey: string, eventId: string, recovery: SimulationRecoveryResult): Promise<boolean> {
    const current = this.runs.get(runKey);
    if (current === undefined || current.state.lastTransition?.eventId !== eventId) return false;
    this.recoveries.set(runKey, clone(recovery));
    return true;
  }

  async findRecovery(runKey: string): Promise<SimulationRecoveryResult | null> {
    return clone(this.recoveries.get(runKey) ?? null);
  }

  async findRunAuditByEventId(
    runKey: string,
    eventId: string
  ): Promise<SimulationRunAuditRecord | null> {
    const found = (this.audits.get(runKey) ?? []).find((event) => event.eventId === eventId);
    return found === undefined ? null : clone(found);
  }

  async listRunAudit(runKey: string): Promise<SimulationRunAuditRecord[]> {
    return clone(this.audits.get(runKey) ?? []);
  }

  async appendRunAudit(event: SimulationRunAuditRecord): Promise<AppendSimulationAuditResult> {
    const events = this.audits.get(event.runKey) ?? [];
    const duplicate = events.find((item) => item.eventId === event.eventId);
    if (duplicate !== undefined) {
      return { disposition: 'duplicate-event', existing: clone(duplicate) };
    }
    const conflict = events.find((item) => item.sequence === event.sequence);
    if (conflict !== undefined) {
      return { disposition: 'sequence-conflict', existing: clone(conflict) };
    }
    events.push(clone(event));
    this.audits.set(event.runKey, events);
    return { disposition: 'inserted' };
  }
}

async function create(
  service: SimulationPersistenceService,
  idempotencyKey = 'request-1',
  live = false
) {
  return service.createRun({
    idempotencyKey,
    live,
    createdAtMs: 1,
    metadata: metadata(),
    dryRunPlan: plan(idempotencyKey),
  });
}

describe('simulation persistence service', () => {
  it('creates a run idempotently and binds the key to immutable metadata', async () => {
    const repository = new MemorySimulationRepository();
    const service = new SimulationPersistenceService(repository);
    const first = await create(service);
    const duplicate = await create(service);

    expect(duplicate).toEqual(first);
    expect(repository.audits.get(first.runKey)).toHaveLength(1);
    await expect(
      service.createRun({
        idempotencyKey: 'request-1',
        live: false,
        createdAtMs: 1,
        metadata: metadata('other-scenario'),
        dryRunPlan: plan('request-1', 'other-scenario'),
      })
    ).rejects.toMatchObject({ code: 'RUN_METADATA_CONFLICT' });
    await expect(
      service.createRun({
        idempotencyKey: 'request-1',
        live: false,
        createdAtMs: 1,
        metadata: metadata(),
        dryRunPlan: plan('request-1', 'dry-run', 999),
      })
    ).rejects.toMatchObject({ code: 'RUN_METADATA_CONFLICT' });
  });

  it('persists transitions with optimistic revisions and idempotent event ids', async () => {
    const repository = new MemorySimulationRepository();
    const service = new SimulationPersistenceService(repository);
    const created = await create(service, 'request-1', true);
    const event = { type: 'begin_preflight' as const, eventId: 'event-1', atMs: 2 };

    const first = await service.transitionRun({ runKey: created.runKey, event, actor });
    const duplicate = await service.transitionRun({ runKey: created.runKey, event, actor });
    expect(first.state).toMatchObject({ status: 'preflight', revision: 1 });
    expect(duplicate.state).toEqual(first.state);
    expect(repository.audits.get(created.runKey)).toHaveLength(2);

    await expect(
      service.transitionRun({
        runKey: created.runKey,
        event: { ...event, atMs: 3 },
        actor,
      })
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('lets concurrent retries of the same event converge on one audit record', async () => {
    const repository = new MemorySimulationRepository();
    const service = new SimulationPersistenceService(repository);
    const created = await create(service);
    const request = {
      runKey: created.runKey,
      event: { type: 'begin_preflight' as const, eventId: 'event-1', atMs: 2 },
      actor,
    };

    const [first, second] = await Promise.all([
      service.transitionRun(request),
      service.transitionRun(request),
    ]);
    expect(first.state).toEqual(second.state);
    expect(first.state).toMatchObject({ status: 'preflight', revision: 1 });
    expect(repository.audits.get(created.runKey)).toHaveLength(2);
  });

  it('repairs a projection when the process dies after audit append but before CAS', async () => {
    const repository = new MemorySimulationRepository();
    const service = new SimulationPersistenceService(repository);
    const created = await create(service);
    repository.failNextCas = true;

    const result = await service.transitionRun({
      runKey: created.runKey,
      event: { type: 'begin_preflight', eventId: 'event-1', atMs: 2 },
      actor,
    });
    expect(result.state).toMatchObject({ status: 'preflight', revision: 1 });
    expect(repository.runs.get(created.runKey)?.state).toEqual(result.state);
  });

  it('recreates a missing projection entirely from the append-only stream', async () => {
    const repository = new MemorySimulationRepository();
    const service = new SimulationPersistenceService(repository);
    const created = await create(service);
    await service.transitionRun({
      runKey: created.runKey,
      event: { type: 'begin_preflight', eventId: 'event-1', atMs: 2 },
      actor,
    });
    repository.runs.delete(created.runKey);

    const rebuilt = await new SimulationPersistenceService(repository).loadRun(created.runKey);
    expect(rebuilt.state).toMatchObject({ status: 'preflight', revision: 1 });
    expect(repository.runs.get(created.runKey)).toEqual(rebuilt);
  });

  it('fails closed when a projection is ahead of or diverges from audit', async () => {
    const repository = new MemorySimulationRepository();
    const service = new SimulationPersistenceService(repository);
    const created = await create(service);
    const projection = repository.runs.get(created.runKey)!;

    repository.runs.set(created.runKey, {
      ...projection,
      state: { ...projection.state, revision: 1 },
    });
    await expect(service.loadRun(created.runKey)).rejects.toMatchObject({
      code: 'PROJECTION_AHEAD_OF_AUDIT',
    });

    repository.runs.set(created.runKey, {
      ...projection,
      state: { ...projection.state, abortRequested: true },
    });
    await expect(service.loadRun(created.runKey)).rejects.toMatchObject({
      code: 'PROJECTION_DIVERGED',
    });
  });

  it('continues a fault-active run after restart and recovers it at lease expiry', async () => {
    const repository = new MemorySimulationRepository();
    let service = new SimulationPersistenceService(repository);
    const created = await create(service, 'fault-restart', true);
    const events = [
      { type: 'begin_preflight' as const, eventId: 'e1', atMs: 2 },
      { type: 'preflight_passed' as const, eventId: 'e2', atMs: 3 },
      { type: 'begin_baseline' as const, eventId: 'e3', atMs: 4 },
      { type: 'baseline_completed' as const, eventId: 'e4', atMs: 5 },
      { type: 'activate_fault' as const, eventId: 'e5', atMs: 6, faultLeaseExpiresAtMs: 900 },
    ];
    for (const event of events) {
      await service.transitionRun({ runKey: created.runKey, event, actor });
    }

    service = new SimulationPersistenceService(repository);
    const active = await service.reconcileRun({ runKey: created.runKey, nowMs: 100, actor: systemActor });
    expect(active.state.status).toBe('fault_active');
    const expired = await service.reconcileRun({ runKey: created.runKey, nowMs: 900, actor: systemActor });
    expect(expired.state).toMatchObject({ status: 'recovery', abortRequested: true, revision: 6 });
  });

  it('elects only one of two concurrent transitions for the same revision', async () => {
    const repository = new MemorySimulationRepository();
    const service = new SimulationPersistenceService(repository);
    const created = await create(service);

    const settled = await Promise.allSettled([
      service.transitionRun({
        runKey: created.runKey,
        event: { type: 'begin_preflight', eventId: 'event-a', atMs: 2 },
        actor,
      }),
      service.transitionRun({
        runKey: created.runKey,
        event: { type: 'begin_preflight', eventId: 'event-b', atMs: 2 },
        actor,
      }),
    ]);

    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(repository.audits.get(created.runKey)).toHaveLength(2);
    expect((await service.loadRun(created.runKey)).state.status).toBe('preflight');
  });

  it('replays a complete dry run from audit without the mutable projection', async () => {
    const repository = new MemorySimulationRepository();
    const service = new SimulationPersistenceService(repository);
    const created = await create(service);
    const events = [
      { type: 'begin_preflight' as const, eventId: 'e1', atMs: 2 },
      { type: 'preflight_passed' as const, eventId: 'e2', atMs: 3 },
      { type: 'begin_baseline' as const, eventId: 'e3', atMs: 4 },
      { type: 'baseline_completed' as const, eventId: 'e4', atMs: 5 },
      { type: 'dry_run_completed' as const, eventId: 'e5', atMs: 6 },
    ];
    for (const event of events) {
      await service.transitionRun({ runKey: created.runKey, event, actor });
    }

    const audit = await repository.listRunAudit(created.runKey);
    const replayed = replaySimulationRunAudit(audit);
    expect(replayed.state).toMatchObject({ status: 'completed', revision: 5, faultMayBeActive: false });
    expect(replayed.state).toEqual(repository.runs.get(created.runKey)?.state);
  });

  it('reports an unknown run without manufacturing a projection', async () => {
    const repository = new MemorySimulationRepository();
    const service = new SimulationPersistenceService(repository);
    await expect(service.loadRun(simulationRunKeyFor('missing'))).rejects.toMatchObject({
      code: 'RUN_NOT_FOUND',
    });
  });

  async function driveToRecovery(service: SimulationPersistenceService, runKey: string) {
    const chain = [
      { type: 'begin_preflight' as const, eventId: 'p1', atMs: 2 },
      { type: 'preflight_passed' as const, eventId: 'p2', atMs: 3 },
      { type: 'begin_baseline' as const, eventId: 'p3', atMs: 4 },
      { type: 'baseline_completed' as const, eventId: 'p4', atMs: 5 },
      { type: 'begin_recovery' as const, eventId: 'p5', atMs: 6 },
    ];
    for (const event of chain) await service.transitionRun({ runKey, event, actor });
  }

  const recoveryResult = (allClear: boolean): SimulationRecoveryResult => ({
    required: true,
    startedAtMs: 6_500,
    finishedAtMs: 7_000,
    allClear,
    targets: [{
      targetId: 'mn-1', faultStateClear: allClear, expectedServiceRunning: allClear,
      observerFresh: true, checkedAtMs: 6_900, privateDetail: null,
    }],
  });

  it('writes a recovery result with the transition, atomically and audited', async () => {
    const repository = new MemorySimulationRepository();
    const service = new SimulationPersistenceService(repository);
    const created = await create(service, 'recovery-run', true);
    await driveToRecovery(service, created.runKey);

    const event = { type: 'recovery_succeeded' as const, eventId: 'rec-1', atMs: 7 };
    const result = await service.recordRecoveryResult({
      runKey: created.runKey, event, recovery: recoveryResult(true), actor,
    });

    // The state moved and the recovery subfield was written in the same CAS.
    expect(result.state).toMatchObject({ status: 'cooldown' });
    expect(repository.recoveries.get(created.runKey)).toMatchObject({ allClear: true, finishedAtMs: 7_000 });
    // It left an audit image bound to the outcome.
    const audit = await repository.listRunAudit(created.runKey);
    expect(audit.at(-1)).toMatchObject({ eventId: 'rec-1', eventType: 'recovery_succeeded', toStatus: 'cooldown' });
  });

  it('records one outcome per eventId idempotently, and the audit still replays', async () => {
    const repository = new MemorySimulationRepository();
    const service = new SimulationPersistenceService(repository);
    const created = await create(service, 'recovery-idem', true);
    await driveToRecovery(service, created.runKey);

    const event = { type: 'recovery_succeeded' as const, eventId: 'rec-1', atMs: 7 };
    const first = await service.recordRecoveryResult({ runKey: created.runKey, event, recovery: recoveryResult(true), actor });
    // A replay of the same event is idempotent: one audit record, one recovery.
    const replay = await service.recordRecoveryResult({ runKey: created.runKey, event, recovery: recoveryResult(true), actor });
    expect(replay.state).toEqual(first.state);
    expect((await repository.listRunAudit(created.runKey)).filter((e) => e.eventId === 'rec-1')).toHaveLength(1);
    // The recovery audit event carries the ordinary fingerprint, so loadRun's
    // replay verification still passes -- the classic way to brick a run.
    await expect(service.loadRun(created.runKey)).resolves.toMatchObject({ state: { status: 'cooldown' } });
    expect(replaySimulationRunAudit(await repository.listRunAudit(created.runKey)).state.status).toBe('cooldown');

    // The same eventId with different event data is the standard conflict.
    await expect(service.recordRecoveryResult({
      runKey: created.runKey, event: { ...event, atMs: 8 }, recovery: recoveryResult(false), actor,
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('recovers the findings when the transition was applied without them by a lost race', async () => {
    const repository = new MemorySimulationRepository();
    const service = new SimulationPersistenceService(repository);
    const created = await create(service, 'recovery-lost-race', true);
    await driveToRecovery(service, created.runKey);

    // Reproduce the lost race: the recovery_succeeded transition is applied and
    // audited by another writer (or loadRun's projection repair), which writes the
    // state but NOT the recovery -- exactly the path that silently dropped the findings.
    const event = { type: 'recovery_succeeded' as const, eventId: 'rec-1', atMs: 7 };
    const atRecovery = await service.loadRun(created.runKey);
    const nextState = transitionSimulationRun(atRecovery.state, event);
    await repository.appendRunAudit(transitionAuditRecord({
      before: atRecovery.state, after: nextState, actor, requestFingerprint: simulationRunEventFingerprint(event),
    }));
    await repository.compareAndSwapRun(created.runKey, atRecovery.state.revision, nextState); // no recovery
    expect(repository.recoveries.get(created.runKey)).toBeUndefined(); // findings lost

    // The fix: recordRecoveryResult places the findings even though the transition
    // is already down, rather than returning success with nothing recorded.
    const result = await service.recordRecoveryResult({ runKey: created.runKey, event, recovery: recoveryResult(true), actor });
    expect(result.state.status).toBe('cooldown');
    expect(repository.recoveries.get(created.runKey)).toMatchObject({ allClear: true, finishedAtMs: 7_000 });
  });
});
