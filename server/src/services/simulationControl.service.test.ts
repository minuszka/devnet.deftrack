import { describe, expect, it } from 'vitest';
import type { SimulationRunAuditRecord } from '../domain/simulationAudit.js';
import type { SimulationRunState } from '../domain/simulationRunState.js';
import { simulationRunKeyFor } from '../domain/simulationIdentity.js';
import type { SimulationRecoveryResult, SimulationRunMetadata, SimulationTargetSnapshot } from '../models/SimulationRun.js';
import { generateDryRunPlan } from '../simulator/dryRunExecutor.js';
import type { PreparedSimulationDraft } from '../simulator/draftPreparation.js';
import type { SimulationPreflightEvaluation } from '../simulator/preflight.js';
import type { SimulationEvidenceProvider } from './simulationEvidence.service.js';
import {
  SimulationControlPersistenceService,
  type SimulationArtifactRecord,
  type SimulationControlPersistenceRepository,
  type SimulationControlRequestRecord,
} from './simulationControlPersistence.service.js';
import { SimulationControlService, type SimulationLiveExecutor } from './simulationControl.service.js';
import { SimulationLiveRunLockService } from './simulationLiveRunLock.service.js';
import type { LiveRunLock } from '../domain/liveRunLock.js';
import {
  SimulationPersistenceService,
  type AppendSimulationAuditResult,
  type SimulationPersistenceRepository,
  type SimulationRunProjection,
} from './simulationPersistence.service.js';

const clone = <T>(value: T): T => structuredClone(value);
const actor = { actorId: 'operator-1', actorType: 'admin-session' as const, displayName: null };
const build = 'b'.repeat(64);
const target: SimulationTargetSnapshot = {
  targetId: 'mn-1', displayLabel: 'MN 1', operatorId: 'op-1', proTxHash: 'a'.repeat(64),
  hostRef: 'private-host-1', unitRef: 'defcond-1', p2pPort: 19_799,
  role: 'masternode', network: 'devnet', capabilities: ['service-control'],
  expectedBuild: build, capturedAtMs: 1_000, capturedAtHeight: 10_000,
};

class MemoryRunRepository implements SimulationPersistenceRepository {
  runs = new Map<string, SimulationRunProjection>();
  audits = new Map<string, SimulationRunAuditRecord[]>();
  async findRun(key: string) { return clone(this.runs.get(key) ?? null); }
  async insertRun(run: SimulationRunProjection) {
    if (this.runs.has(run.runKey)) return 'existing' as const;
    this.runs.set(run.runKey, clone(run));
    return 'inserted' as const;
  }
  async compareAndSwapRun(key: string, revision: number, state: SimulationRunState, recovery?: SimulationRecoveryResult) {
    const run = this.runs.get(key);
    if (run === undefined || run.state.revision !== revision) return false;
    this.runs.set(key, { ...run, state: clone(state) });
    if (recovery !== undefined) this.recoveries.set(key, clone(recovery));
    return true;
  }
  async findRunAuditByEventId(key: string, eventId: string) {
    return clone((this.audits.get(key) ?? []).find((event) => event.eventId === eventId) ?? null);
  }
  recoveries = new Map<string, SimulationRecoveryResult>();
  async writeRecoveryForEvent(runKey: string, eventId: string, recovery: SimulationRecoveryResult): Promise<boolean> {
    const current = this.runs.get(runKey);
    if (current === undefined || current.state.lastTransition?.eventId !== eventId) return false;
    this.recoveries.set(runKey, clone(recovery));
    return true;
  }
  async findRecovery(runKey: string): Promise<SimulationRecoveryResult | null> {
    return clone(this.recoveries.get(runKey) ?? null);
  }
  async listRunAudit(key: string) { return clone(this.audits.get(key) ?? []); }
  async appendRunAudit(event: SimulationRunAuditRecord): Promise<AppendSimulationAuditResult> {
    const events = this.audits.get(event.runKey) ?? [];
    const duplicate = events.find((item) => item.eventId === event.eventId);
    if (duplicate) return { disposition: 'duplicate-event', existing: clone(duplicate) };
    const conflict = events.find((item) => item.sequence === event.sequence);
    if (conflict) return { disposition: 'sequence-conflict', existing: clone(conflict) };
    events.push(clone(event));
    this.audits.set(event.runKey, events);
    return { disposition: 'inserted' };
  }
}

class MemoryControlRepository implements SimulationControlPersistenceRepository {
  requests = new Map<string, SimulationControlRequestRecord>();
  artifacts = new Map<string, SimulationArtifactRecord>();
  async insertControlRequest(record: SimulationControlRequestRecord) {
    if (this.requests.has(record.requestKey)) return 'existing' as const;
    this.requests.set(record.requestKey, clone(record));
    return 'inserted' as const;
  }
  async findControlRequest(key: string) { return clone(this.requests.get(key) ?? null); }
  async insertArtifact(record: SimulationArtifactRecord) {
    if (this.artifacts.has(record.artifactId)) return 'existing' as const;
    this.artifacts.set(record.artifactId, clone(record));
    return 'inserted' as const;
  }
  async findArtifact(key: string) { return clone(this.artifacts.get(key) ?? null); }
  async listArtifacts(runKey: string) {
    return clone([...this.artifacts.values()].filter((artifact) => artifact.runKey === runKey));
  }
  async projectPreflight() { return true; }
}

function passedPreflight(nowMs: number): SimulationPreflightEvaluation {
  return {
    passed: true,
    checkedAtMs: nowMs,
    checks: [{
      checkId: 'network-identity', severity: 'required', passed: true,
      checkedAtMs: nowMs, publicMessage: 'ok', privateDetail: null,
    }],
    dataQuality: {
      observerCoveragePercent: 100, staleTargetCount: 0, explorerLagBlocks: 0,
      missingHeights: [], confidence: 'high',
    },
  };
}

class FakeEvidence implements SimulationEvidenceProvider {
  baselineRequirements: boolean[] = [];
  constructor(private readonly scenario: Record<string, unknown>) {}
  async prepareDraft(input: Parameters<SimulationEvidenceProvider['prepareDraft']>[0]): Promise<PreparedSimulationDraft> {
    const runKey = simulationRunKeyFor(input.idempotencyKey);
    // The target's network must match the run's, or the run metadata is invalid.
    const networkTarget = { ...target, network: input.network };
    const plan = generateDryRunPlan(
      { runKey, network: input.network, scenario: this.scenario },
      { network: input.network, currentHeight: 10_000, targets: [networkTarget], quorumMemberTargetIds: [networkTarget.targetId] }
    );
    const metadata: SimulationRunMetadata = {
      network: input.network,
      scenarioId: plan.scenarioId,
      scenarioVersion: plan.scenarioVersion,
      parameters: plan.parameters,
      seed: plan.seed,
      targetSnapshot: [networkTarget],
      experimentRunKey: null,
      baselineRunKey: null,
      requestedBy: input.requestedBy,
    };
    return {
      runKey,
      metadata,
      dryRunPlan: plan,
      targetInventory: {
        network: input.network, capturedAtMs: input.nowMs, capturedAtHeight: 10_000,
        snapshots: [networkTarget], issues: [], complete: true,
      },
    };
  }
  readonly evaluateClocks: number[] = [];
  failNextEvaluate = false;
  async evaluate(input: Parameters<SimulationEvidenceProvider['evaluate']>[0]) {
    this.baselineRequirements.push(input.baselineRequired);
    this.evaluateClocks.push(input.nowMs);
    if (this.failNextEvaluate) {
      this.failNextEvaluate = false;
      throw new Error('transient RPC timeout to defcond');
    }
    return passedPreflight(input.nowMs);
  }
}

class FakeExecutor implements SimulationLiveExecutor {
  activated = 0;
  recovered = 0;
  allClear = true;
  async activateFault(): Promise<void> { this.activated++; }
  async proveRecovery(): Promise<SimulationRecoveryResult> {
    this.recovered++;
    return { required: true, startedAtMs: 1_000, finishedAtMs: 1_100, allClear: this.allClear, targets: [] };
  }
}

class MemoryLockRepository {
  lock: LiveRunLock | null = null;
  async find(): Promise<LiveRunLock | null> { return this.lock === null ? null : structuredClone(this.lock); }
  async compareAndSwap(revision: number | null, next: LiveRunLock): Promise<boolean> {
    if ((this.lock?.revision ?? null) !== revision) return false;
    this.lock = structuredClone(next);
    return true;
  }
}

function harness(
  scenario: Record<string, unknown>,
  role: 'operator' | 'safety-admin' = 'operator',
  executor?: SimulationLiveExecutor,
  clock: () => number = () => 1_000,
  lockRepository?: MemoryLockRepository
) {
  const runRepository = new MemoryRunRepository();
  const controlRepository = new MemoryControlRepository();
  const evidence = new FakeEvidence(scenario);
  const service = new SimulationControlService(
    new SimulationPersistenceService(runRepository),
    new SimulationControlPersistenceService(controlRepository),
    evidence,
    { actor, role },
    clock,
    executor,
    lockRepository === undefined ? undefined : new SimulationLiveRunLockService(lockRepository)
  );
  return { service, runRepository, controlRepository, evidence, lockRepository };
}

async function driveToLiveArmed(
  service: ReturnType<typeof harness>['service'],
  network: 'regtest' | 'devnet',
  // Distinct runs need distinct idempotency keys: the run key is derived from
  // this, so two callers sharing it would be driving the SAME run.
  tag = 'live'
) {
  const created = await service.create({
    idempotencyKey: `${network}-${tag}-create`, network, live: true, scenario: mnStop,
  });
  await service.validate({ runKey: created.run.runKey, idempotencyKey: `${network}-${tag}-validate` });
  await service.arm({
    runKey: created.run.runKey, idempotencyKey: `${network}-${tag}-arm`, acknowledgedRiskClass: 'medium',
  });
  return created.run.runKey;
}

const mnStop = {
  scenarioId: 'mn-stop', scenarioVersion: 1, seed: 'control-seed',
  parameters: { count: 1, durationSeconds: 30, targetIds: ['mn-1'] },
};

describe('simulation control service', () => {
  it('runs and replays the complete safe DryRun lifecycle', async () => {
    const { service, runRepository, controlRepository, evidence } = harness(mnStop);
    const created = await service.create({
      idempotencyKey: 'lifecycle-create', network: 'devnet', live: false, scenario: mnStop,
    });
    const replayedCreate = await service.create({
      idempotencyKey: 'lifecycle-create', network: 'devnet', live: false, scenario: mnStop,
    });
    expect(created.run.state.status).toBe('draft');
    expect(replayedCreate.idempotentReplay).toBe(true);
    expect(created.run.state.runExpiresAtMs).toBeGreaterThan(1_000 + 30_000);

    const validated = await service.validate({
      runKey: created.run.runKey, idempotencyKey: 'lifecycle-validate',
    });
    expect(validated.run.state.status).toBe('scheduled');
    expect((await service.dryRun(created.run.runKey)).plan.planFingerprint).toMatch(/^[0-9a-f]{64}$/);

    const armed = await service.arm({
      runKey: created.run.runKey,
      idempotencyKey: 'lifecycle-arm',
      acknowledgedRiskClass: 'medium',
    });
    expect(armed.run.state.status).toBe('armed');
    const completed = await service.start({
      runKey: created.run.runKey, idempotencyKey: 'lifecycle-start',
    });
    expect(completed.run.state.status).toBe('completed');
    expect((await service.start({
      runKey: created.run.runKey, idempotencyKey: 'lifecycle-start',
    })).run.state.revision).toBe(completed.run.state.revision);

    const history = await service.history(created.run.runKey);
    expect(history.audit.map((event) => event.eventType)).toEqual([
      'run_created', 'begin_preflight', 'preflight_passed',
      'begin_baseline', 'baseline_completed', 'dry_run_completed',
    ]);
    expect(evidence.baselineRequirements).toEqual([false, true]);
    expect(runRepository.audits.get(created.run.runKey)).toHaveLength(6);
    expect(JSON.stringify([...controlRepository.requests.values()])).not.toContain('lifecycle-create');
    expect([...controlRepository.artifacts.values()].filter((artifact) => artifact.kind === 'dry-run')).toHaveLength(1);
  });


  it('refuses to execute a live run that is not on the lab network', async () => {
    const { service } = harness(mnStop);
    const runKey = await driveToLiveArmed(service, 'devnet');
    await expect(service.start({ runKey, idempotencyKey: 'devnet-live-start' }))
      .rejects.toMatchObject({ code: 'EXECUTOR_NETWORK_FORBIDDEN' });
  });

  it('lets a live lab-network run through the boundary to the not-yet-built executor', async () => {
    const { service } = harness(mnStop);
    const runKey = await driveToLiveArmed(service, 'regtest');
    // The network guard passes; no executor is configured, so it stays closed.
    await expect(service.start({ runKey, idempotencyKey: 'regtest-live-start' }))
      .rejects.toMatchObject({ code: 'EXECUTOR_NOT_AVAILABLE' });
  });

  it('start activates the fault on a configured executor', async () => {
    const executor = new FakeExecutor();
    const { service } = harness(mnStop, 'operator', executor);
    const runKey = await driveToLiveArmed(service, 'regtest');
    const { run } = await service.start({ runKey, idempotencyKey: 'start-run-1' });
    expect(executor.activated).toBe(1);
    expect(run.state.status).toBe('fault_active');
    expect(run.state.faultLeaseExpiresAtMs).toBeGreaterThan(1_000);
  });

  it('abort proves recovery and records the outcome', async () => {
    const executor = new FakeExecutor();
    const { service } = harness(mnStop, 'operator', executor);
    const runKey = await driveToLiveArmed(service, 'regtest');
    await service.start({ runKey, idempotencyKey: 'start-run-1' });
    const { run } = await service.abort({ runKey, idempotencyKey: 'abort-run-1' });
    expect(executor.recovered).toBe(1);
    // abort set the intent, so a clean recovery resolves to aborted.
    expect(run.state.status).toBe('aborted');
  });

  it('recover proves recovery into cooldown when there was no abort', async () => {
    const executor = new FakeExecutor();
    const { service } = harness(mnStop, 'operator', executor);
    const runKey = await driveToLiveArmed(service, 'regtest');
    await service.start({ runKey, idempotencyKey: 'start-run-1' });
    const { run } = await service.recover({ runKey, idempotencyKey: 'recover-run-1' });
    expect(executor.recovered).toBe(1);
    expect(run.state.status).toBe('cooldown');
  });

  it('a failed recovery proof takes a live run to failed, with the findings recorded', async () => {
    const executor = new FakeExecutor();
    executor.allClear = false;
    const { service, runRepository } = harness(mnStop, 'operator', executor);
    const runKey = await driveToLiveArmed(service, 'regtest');
    await service.start({ runKey, idempotencyKey: 'start-run-1' });
    const { run } = await service.recover({ runKey, idempotencyKey: 'recover-run-1' });
    expect(run.state.status).toBe('failed');
    expect(runRepository.recoveries.get(runKey)).toMatchObject({ allClear: false });
  });

  it('binds an idempotency key to one exact create request', async () => {
    const { service } = harness(mnStop);
    await service.create({
      idempotencyKey: 'bound-create-key', network: 'devnet', live: false, scenario: mnStop,
    });
    await expect(service.create({
      idempotencyKey: 'bound-create-key', network: 'devnet', live: true, scenario: mnStop,
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('gives scenario riskClass a real approval role gate', async () => {
    const highRisk = {
      scenarioId: 'host-outage', scenarioVersion: 1, seed: 'high-risk',
      parameters: { anchorTargetId: 'mn-1', durationSeconds: 30, expectedMasternodes: 1 },
    };
    const { service } = harness(highRisk, 'operator');
    const created = await service.create({
      idempotencyKey: 'highrisk-create', network: 'devnet', live: false, scenario: highRisk,
    });
    await service.validate({ runKey: created.run.runKey, idempotencyKey: 'highrisk-validate' });
    await expect(service.arm({
      runKey: created.run.runKey,
      idempotencyKey: 'highrisk-arm',
      acknowledgedRiskClass: 'high',
    })).rejects.toMatchObject({ code: 'APPROVAL_DENIED' });
    expect((await service.status(created.run.runKey)).state.status).toBe('scheduled');
  });

  it('recovers a run that never executed into aborted, not completed', async () => {
    const { service, runRepository } = harness(mnStop);
    const created = await service.create({
      idempotencyKey: 'never-ran-create', network: 'devnet', live: false, scenario: mnStop,
    });
    const runKey = created.run.runKey;
    await service.validate({ runKey, idempotencyKey: 'never-ran-validate' });
    const armed = await service.arm({
      runKey, idempotencyKey: 'never-ran-arm', acknowledgedRiskClass: 'medium',
    });
    expect(armed.run.state.status).toBe('armed');

    const recovered = await service.recover({ runKey, idempotencyKey: 'never-ran-recover' });

    // The run never executed -- nothing produced a dry_run_completed -- so it
    // must not claim success. recovery_succeeded resolves its terminal status
    // from abortRequested, which recover did not set, and every recover call on
    // a dry run lands here because `armed` is the only status it can be in.
    const audit = await runRepository.listRunAudit(runKey);
    expect(audit.map((event) => event.eventType)).not.toContain('dry_run_completed');
    expect(recovered.run.state.status).toBe('aborted');
    expect(recovered.run.state.faultMayBeActive).toBe(false);

    // The same shape abort() produces, reached the same way.
    expect(audit.map((event) => event.eventType)).toEqual([
      'run_created', 'begin_preflight', 'preflight_passed',
      'begin_baseline', 'baseline_completed',
      'abort_requested', 'begin_recovery', 'recovery_succeeded',
    ]);
  });

  it('still completes a recovery for a run that did execute', async () => {
    const { service } = harness(mnStop);
    const created = await service.create({
      idempotencyKey: 'executed-create', network: 'devnet', live: false, scenario: mnStop,
    });
    const runKey = created.run.runKey;
    await service.validate({ runKey, idempotencyKey: 'executed-validate' });
    await service.arm({ runKey, idempotencyKey: 'executed-arm', acknowledgedRiskClass: 'medium' });
    const done = await service.start({ runKey, idempotencyKey: 'executed-start' });

    // A run that ran to completion is terminal; the abort intent added above
    // must not reach into this path and turn a finished run into an aborted one.
    expect(done.run.state.status).toBe('completed');
  });
});

describe('live telemetry is judged against a live clock', () => {
  it('re-evaluates a retried request against the clock now, not the instant it was claimed', async () => {
    // The finding's exact trigger. validate() is claimed (acceptedAtMs is written)
    // and then fails inside evidence.evaluate -- a transient RPC timeout, a Mongo
    // hiccup, a restart. The operator retries with the same idempotency key, which
    // is what the CLI does. claim() returns the ORIGINAL record, and no preflight
    // artifact exists yet, so the evidence runs again.
    //
    // Against the frozen instant every host has reported "in the future" since,
    // which used to fail two required checks and burn the run into terminal
    // `rejected`, blaming the fleet for a clock the server had frozen itself.
    let now = 1_000;
    const { service, evidence } = harness(mnStop, 'operator', undefined, () => now);
    const runKey = (await service.create({
      idempotencyKey: 'retry-create', network: 'devnet', live: false, scenario: mnStop,
    })).run.runKey;

    evidence.failNextEvaluate = true;
    await expect(service.validate({ runKey, idempotencyKey: 'retry-validate' })).rejects.toThrow(/transient/);
    expect(evidence.evaluateClocks.at(-1)).toBe(1_000);

    now = 900_000; // the operator retries much later, under the same key
    await service.validate({ runKey, idempotencyKey: 'retry-validate' });
    expect(evidence.evaluateClocks.at(-1)).toBe(900_000);
  });

  it('keeps the audit event stamped with the frozen accept time', async () => {
    // The freeze is right for the event; it was only ever wrong as a freshness
    // reference. A replayed request must still write one event at one instant.
    let now = 1_000;
    const { service, runRepository } = harness(mnStop, 'operator', undefined, () => now);
    const created = await service.create({ idempotencyKey: 'audit-create', network: 'devnet', live: false, scenario: mnStop });
    now = 900_000;
    const replay = await service.create({ idempotencyKey: 'audit-create', network: 'devnet', live: false, scenario: mnStop });
    expect(replay.run.state.createdAtMs).toBe(created.run.state.createdAtMs);
    expect(runRepository.audits.get(created.run.runKey)?.[0]?.atMs).toBe(1_000);
  });
});

describe('one live run at a time', () => {
  it('refuses a second live run while the first holds the lab', async () => {
    // The preflight's conflict check is an ordinary query, so two validations can
    // both pass before either transitions. The lock is decided atomically.
    const shared = new MemoryLockRepository();
    const first = harness(mnStop, 'operator', new FakeExecutor(), () => 1_000, shared);
    const second = harness(mnStop, 'operator', new FakeExecutor(), () => 1_000, shared);

    const runA = await driveToLiveArmed(first.service, 'regtest', 'lock-a');
    await first.service.start({ runKey: runA, idempotencyKey: 'lock-start-a' });

    const runB = await driveToLiveArmed(second.service, 'regtest', 'lock-b');
    await expect(second.service.start({ runKey: runB, idempotencyKey: 'lock-start-b' }))
      .rejects.toMatchObject({ code: 'LIVE_RUN_LOCKED' });
  });

  it('releases the lab once recovery is recorded, so the next run may start', async () => {
    const shared = new MemoryLockRepository();
    const first = harness(mnStop, 'operator', new FakeExecutor(), () => 1_000, shared);
    const second = harness(mnStop, 'operator', new FakeExecutor(), () => 1_000, shared);

    const runA = await driveToLiveArmed(first.service, 'regtest', 'rel-a');
    await first.service.start({ runKey: runA, idempotencyKey: 'rel-start-a' });
    await first.service.recover({ runKey: runA, idempotencyKey: 'rel-recover-a' });

    const runB = await driveToLiveArmed(second.service, 'regtest', 'rel-b');
    const started = await second.service.start({ runKey: runB, idempotencyKey: 'rel-start-b' });
    expect(started.run.state.status).toBe('fault_active');
  });

  it('does not let an abandoned run hold the lab for ever', async () => {
    // The lease is the run's own envelope. A run that dies holding the lock stops
    // blocking when that envelope ends -- which is what the query-based check,
    // having no expiry at all, could never do.
    const shared = new MemoryLockRepository();
    const first = harness(mnStop, 'operator', new FakeExecutor(), () => 1_000, shared);
    const runA = await driveToLiveArmed(first.service, 'regtest', 'aband-a');
    await first.service.start({ runKey: runA, idempotencyKey: 'aband-start-a' });
    const heldUntil = (shared.lock as { leaseUntilMs: number }).leaseUntilMs;

    // ...the process holding it never comes back. Long after its envelope:
    const later = harness(mnStop, 'operator', new FakeExecutor(), () => heldUntil + 1, shared);
    const runB = await driveToLiveArmed(later.service, 'regtest', 'aband-b');
    const started = await later.service.start({ runKey: runB, idempotencyKey: 'aband-start-b' });
    expect(started.run.state.status).toBe('fault_active');
  });

  it('leaves behaviour unchanged when no lock is wired', async () => {
    // A deployment without the collection must not silently lose the check it had.
    const { service } = harness(mnStop, 'operator', new FakeExecutor());
    const runKey = await driveToLiveArmed(service, 'regtest');
    const { run } = await service.start({ runKey, idempotencyKey: 'nolock-start' });
    expect(run.state.status).toBe('fault_active');
  });
});
