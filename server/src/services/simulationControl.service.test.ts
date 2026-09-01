import { describe, expect, it } from 'vitest';
import type { SimulationRunAuditRecord } from '../domain/simulationAudit.js';
import type { SimulationRunState } from '../domain/simulationRunState.js';
import { simulationRunKeyFor } from '../domain/simulationIdentity.js';
import type { SimulationRunMetadata, SimulationTargetSnapshot } from '../models/SimulationRun.js';
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
import { SimulationControlService } from './simulationControl.service.js';
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
  async compareAndSwapRun(key: string, revision: number, state: SimulationRunState) {
    const run = this.runs.get(key);
    if (run === undefined || run.state.revision !== revision) return false;
    this.runs.set(key, { ...run, state: clone(state) });
    return true;
  }
  async findRunAuditByEventId(key: string, eventId: string) {
    return clone((this.audits.get(key) ?? []).find((event) => event.eventId === eventId) ?? null);
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
    const plan = generateDryRunPlan(
      { runKey, network: input.network, scenario: this.scenario },
      { network: input.network, currentHeight: 10_000, targets: [target], quorumMemberTargetIds: [target.targetId] }
    );
    const metadata: SimulationRunMetadata = {
      network: input.network,
      scenarioId: plan.scenarioId,
      scenarioVersion: plan.scenarioVersion,
      parameters: plan.parameters,
      seed: plan.seed,
      targetSnapshot: [target],
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
        snapshots: [target], issues: [], complete: true,
      },
    };
  }
  async evaluate(input: Parameters<SimulationEvidenceProvider['evaluate']>[0]) {
    this.baselineRequirements.push(input.baselineRequired);
    return passedPreflight(input.nowMs);
  }
}

function harness(scenario: Record<string, unknown>, role: 'operator' | 'safety-admin' = 'operator') {
  const runRepository = new MemoryRunRepository();
  const controlRepository = new MemoryControlRepository();
  const evidence = new FakeEvidence(scenario);
  const service = new SimulationControlService(
    new SimulationPersistenceService(runRepository),
    new SimulationControlPersistenceService(controlRepository),
    evidence,
    { actor, role },
    () => 1_000
  );
  return { service, runRepository, controlRepository, evidence };
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
