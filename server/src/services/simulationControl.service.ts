import { simulationFingerprint } from '../domain/simulationAudit.js';
import { simulationRunKeyFor } from '../domain/simulationIdentity.js';
import type { SimulationRunEvent, SimulationRunStatus } from '../domain/simulationRunState.js';
import type {
  SimulationAuditActor,
  SimulationNetwork,
  SimulationRecoveryResult,
  SimulationRunMetadata,
} from '../models/SimulationRun.js';
import type { SimulationControlRole } from '../models/SimulationControlRequest.js';
import { authorizeSimulationApproval } from '../simulator/simulationApproval.js';
import { parseScenarioRequest, scenarioDescriptors } from '../simulator/scenarioRegistry.js';
import type { DryRunPlan } from '../simulator/scenarioTypes.js';
import { deriveSimulationRunTiming, faultLeaseExpiresAtForStart } from '../simulator/simulationTiming.js';
import type { SimulationEvidenceProvider } from './simulationEvidence.service.js';
import {
  SimulationControlPersistenceService,
  type SimulationArtifactRecord,
  type SimulationControlRequestRecord,
} from './simulationControlPersistence.service.js';
import {
  SimulationPersistenceError,
  SimulationPersistenceService,
  type SimulationRunProjection,
} from './simulationPersistence.service.js';

export class SimulationControlError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_REQUEST'
      | 'RUN_NOT_FOUND'
      | 'INVALID_STATE'
      | 'PREFLIGHT_FAILED'
      | 'APPROVAL_DENIED'
      | 'EXECUTOR_NOT_AVAILABLE'
      | 'EXECUTOR_NETWORK_FORBIDDEN'
      | 'CORRUPT_ARTIFACT',
    message: string,
    public readonly details: unknown = null
  ) {
    super(message);
    this.name = 'SimulationControlError';
  }
}

/**
 * The only network the executor is ever allowed to act on.
 *
 * A live run carries a target snapshot whose hostRef, on any real network, is a
 * masternode's actual address. The executor binds to that snapshot, so a live
 * run on anything but the local lab would put it one missing `--network regtest`
 * away from holding real fleet host identities. This is a design constant, not a
 * setting: making the lab configurable would be the foot-gun the guard exists to
 * remove.
 */
const EXECUTOR_LAB_NETWORK: SimulationNetwork = 'regtest';

export interface SimulationControlIdentity {
  actor: SimulationAuditActor;
  role: SimulationControlRole;
}

function eventFor(
  request: SimulationControlRequestRecord,
  suffix: string,
  type: Exclude<SimulationRunEvent['type'], 'activate_fault'>
): SimulationRunEvent {
  return { eventId: `${request.requestKey}:${suffix}`, type, atMs: request.acceptedAtMs };
}

/** activate_fault carries the fault lease, so eventFor (which excludes it) cannot build it. */
function activateFaultEventFor(request: SimulationControlRequestRecord, faultLeaseExpiresAtMs: number): SimulationRunEvent {
  return { type: 'activate_fault', eventId: `${request.requestKey}:activate`, atMs: request.acceptedAtMs, faultLeaseExpiresAtMs };
}

/** The recovery outcome, chosen by whether the lab came back clean. */
function recoveryOutcomeEventFor(request: SimulationControlRequestRecord, allClear: boolean): SimulationRunEvent {
  return allClear
    ? { type: 'recovery_succeeded', eventId: `${request.requestKey}:recovered`, atMs: request.acceptedAtMs }
    : { type: 'recovery_failed', eventId: `${request.requestKey}:recovery-failed`, atMs: request.acceptedAtMs };
}

/**
 * The live executor the control slots drive: it applies the run's fault to the lab
 * and, at recovery, clears it and reports whether the lab came back clean. Kept a
 * port so the control flow is testable with a fake, and so a deployment without a
 * configured executor fails closed rather than pretending to run.
 */
export interface SimulationLiveExecutor {
  activateFault(input: { run: SimulationRunProjection; plan: DryRunPlan; faultLeaseExpiresAtMs: number }): Promise<void>;
  proveRecovery(input: { run: SimulationRunProjection }): Promise<SimulationRecoveryResult>;
}

/** The default when none is configured: the slots stay closed, as before day 8. */
const EXECUTOR_UNAVAILABLE: SimulationLiveExecutor = {
  activateFault() {
    return Promise.reject(new SimulationControlError('EXECUTOR_NOT_AVAILABLE', 'live execution requires a configured executor'));
  },
  proveRecovery() {
    return Promise.reject(new SimulationControlError('EXECUTOR_NOT_AVAILABLE', 'live recovery proof requires a configured executor'));
  },
};

function dryRunPlanFingerprint(plan: DryRunPlan): string {
  const { planFingerprint: _ignored, ...unsigned } = plan;
  return simulationFingerprint(unsigned);
}

function creationFromArtifact(
  runKey: string,
  metadata: SimulationRunMetadata,
  artifact: SimulationArtifactRecord
): DryRunPlan {
  if (simulationFingerprint(artifact.payload) !== artifact.payloadFingerprint) {
    throw new SimulationControlError('CORRUPT_ARTIFACT', 'stored DryRun artifact fingerprint is invalid');
  }
  const plan = artifact.payload.plan as DryRunPlan | undefined;
  if (
    plan === undefined ||
    plan.mode !== 'dry-run' ||
    plan.runKey !== runKey ||
    plan.network !== metadata.network ||
    plan.scenarioId !== metadata.scenarioId ||
    plan.scenarioVersion !== metadata.scenarioVersion ||
    plan.seed !== metadata.seed ||
    plan.planFingerprint !== dryRunPlanFingerprint(plan)
  ) {
    throw new SimulationControlError('CORRUPT_ARTIFACT', 'stored DryRun plan failed integrity checks');
  }
  parseScenarioRequest({
    scenarioId: plan.scenarioId,
    scenarioVersion: plan.scenarioVersion,
    seed: plan.seed,
    parameters: plan.parameters,
  });
  if (simulationFingerprint(plan.parameters) !== simulationFingerprint(metadata.parameters)) {
    throw new SimulationControlError('CORRUPT_ARTIFACT', 'stored DryRun parameters differ from immutable metadata');
  }
  return plan;
}

function planFromArtifact(run: SimulationRunProjection, artifact: SimulationArtifactRecord): DryRunPlan {
  return creationFromArtifact(run.runKey, run.metadata, artifact);
}

type StoredPreflight = {
  passed: boolean;
  checks: Parameters<SimulationControlPersistenceService['recordPreflight']>[0]['checks'];
  dataQuality: Parameters<SimulationControlPersistenceService['recordPreflight']>[0]['dataQuality'];
};

function preflightFromArtifact(artifact: SimulationArtifactRecord): StoredPreflight {
  const payload = artifact.payload as Partial<StoredPreflight>;
  if (
    simulationFingerprint(artifact.payload) !== artifact.payloadFingerprint ||
    typeof payload.passed !== 'boolean' ||
    !Array.isArray(payload.checks) ||
    typeof payload.dataQuality !== 'object' ||
    payload.dataQuality === null
  ) {
    throw new SimulationControlError('CORRUPT_ARTIFACT', 'stored preflight artifact is invalid');
  }
  return payload as StoredPreflight;
}

function ensureStatus(run: SimulationRunProjection, allowed: readonly SimulationRunStatus[]): void {
  if (!allowed.includes(run.state.status)) {
    throw new SimulationControlError(
      'INVALID_STATE',
      `run is ${run.state.status}; expected ${allowed.join(' or ')}`
    );
  }
}

export class SimulationControlService {
  constructor(
    private readonly runs: SimulationPersistenceService,
    private readonly control: SimulationControlPersistenceService,
    private readonly evidence: SimulationEvidenceProvider,
    private readonly identity: SimulationControlIdentity,
    private readonly clock: () => number = Date.now,
    private readonly executor: SimulationLiveExecutor = EXECUTOR_UNAVAILABLE
  ) {}

  scenarios() {
    return scenarioDescriptors();
  }

  private claim(input: {
    operation: 'create' | 'validate' | 'arm' | 'start' | 'abort' | 'recover';
    runKey: string | null;
    idempotencyKey: string;
    payload: unknown;
  }): Promise<SimulationControlRequestRecord> {
    return this.control.claim({
      operation: input.operation,
      runKey: input.runKey,
      idempotencyKey: input.idempotencyKey,
      requestPayload: input.payload,
      actor: this.identity.actor,
      role: this.identity.role,
      nowMs: this.clock(),
    });
  }

  private async loadPlan(run: SimulationRunProjection): Promise<DryRunPlan> {
    const artifacts = await this.control.listArtifacts(run.runKey);
    const matches = artifacts.filter((candidate) => candidate.kind === 'dry-run');
    if (matches.length !== 1) {
      throw new SimulationControlError('CORRUPT_ARTIFACT', 'run has no immutable DryRun artifact');
    }
    return planFromArtifact(run, matches[0]!);
  }

  async create(input: {
    idempotencyKey: string;
    network: SimulationNetwork;
    live: boolean;
    scenario: unknown;
  }) {
    const scenario = parseScenarioRequest(input.scenario);
    const request = await this.claim({
      operation: 'create',
      runKey: null,
      idempotencyKey: input.idempotencyKey,
      payload: { network: input.network, live: input.live, scenario },
    });
    const runKey = simulationRunKeyFor(input.idempotencyKey);
    try {
      const existingRun = await this.runs.loadRun(runKey);
      return { run: existingRun, plan: await this.loadPlan(existingRun), idempotentReplay: true };
    } catch (error) {
      if (!(error instanceof SimulationPersistenceError) || error.code !== 'RUN_NOT_FOUND') throw error;
    }
    let prepared = null;
    const existingArtifact = await this.control.findRequestArtifact(runKey, request.requestKey, 'dry-run');
    if (existingArtifact === null) {
      prepared = await this.evidence.prepareDraft({
        idempotencyKey: input.idempotencyKey,
        network: input.network,
        scenario,
        nowMs: request.acceptedAtMs,
        requestedBy: this.identity.actor,
      });
      await this.control.appendArtifact({
        request,
        runKey,
        kind: 'dry-run',
        payload: { plan: prepared.dryRunPlan, metadata: prepared.metadata },
      });
    } else {
      if (simulationFingerprint(existingArtifact.payload) !== existingArtifact.payloadFingerprint) {
        throw new SimulationControlError('CORRUPT_ARTIFACT', 'stored creation artifact fingerprint is invalid');
      }
      const metadata = existingArtifact.payload.metadata as SimulationRunMetadata;
      const dryRunPlan = creationFromArtifact(runKey, metadata, existingArtifact);
      prepared = {
        runKey,
        dryRunPlan,
        metadata,
        targetInventory: null,
      };
    }
    const run = await this.runs.createRun({
      idempotencyKey: input.idempotencyKey,
      live: input.live,
      createdAtMs: request.acceptedAtMs,
      metadata: prepared.metadata,
      dryRunPlan: prepared.dryRunPlan,
    });
    // Validates the append-only payload against the authoritative run metadata.
    planFromArtifact(run, (await this.control.findRequestArtifact(
      runKey, request.requestKey, 'dry-run'
    ))!);
    return { run, plan: prepared.dryRunPlan, idempotentReplay: false };
  }

  async validate(input: { runKey: string; idempotencyKey: string }) {
    const request = await this.claim({
      operation: 'validate', runKey: input.runKey, idempotencyKey: input.idempotencyKey, payload: {},
    });
    let run = await this.runs.loadRun(input.runKey);
    const plan = await this.loadPlan(run);
    if (run.state.status === 'draft') {
      run = await this.runs.transitionRun({
        runKey: run.runKey,
        event: eventFor(request, 'begin', 'begin_preflight'),
        actor: request.actor,
      });
    }
    const existing = await this.control.findRequestArtifact(run.runKey, request.requestKey, 'preflight');
    if (existing === null) ensureStatus(run, ['preflight']);
    else ensureStatus(run, ['preflight', 'scheduled', 'rejected']);
    let evaluation;
    if (existing !== null) {
      evaluation = preflightFromArtifact(existing);
    } else {
      evaluation = await this.evidence.evaluate({
        run,
        plan,
        nowMs: request.acceptedAtMs,
        baselineRequired: false,
      });
    }
    await this.control.recordPreflight({
      request,
      runKey: run.runKey,
      checks: evaluation.checks,
      dataQuality: evaluation.dataQuality,
      passed: evaluation.passed,
    });
    if (run.state.status === 'preflight') {
      run = await this.runs.transitionRun({
        runKey: run.runKey,
        event: eventFor(request, 'result', evaluation.passed ? 'preflight_passed' : 'preflight_rejected'),
        actor: request.actor,
      });
    }
    return { run, preflight: evaluation };
  }

  async dryRun(runKey: string) {
    const run = await this.runs.loadRun(runKey);
    return { run, plan: await this.loadPlan(run) };
  }

  async arm(input: {
    runKey: string;
    idempotencyKey: string;
    acknowledgedRiskClass: string;
  }) {
    const request = await this.claim({
      operation: 'arm', runKey: input.runKey, idempotencyKey: input.idempotencyKey,
      payload: { acknowledgedRiskClass: input.acknowledgedRiskClass },
    });
    let run = await this.runs.loadRun(input.runKey);
    let approval;
    try {
      approval = authorizeSimulationApproval({
        scenarioId: run.metadata.scenarioId,
        acknowledgedRiskClass: input.acknowledgedRiskClass,
        role: request.role,
      });
    } catch (error) {
      throw new SimulationControlError(
        'INVALID_REQUEST',
        error instanceof Error ? error.message : 'invalid risk acknowledgement'
      );
    }
    if (!approval.allowed) {
      throw new SimulationControlError(
        'APPROVAL_DENIED',
        `${request.role} may not approve ${approval.riskClass}-risk simulations`,
        approval
      );
    }
    if (run.state.status === 'armed') return { run, approval, idempotentReplay: true };
    ensureStatus(run, ['scheduled', 'baseline']);
    const plan = await this.loadPlan(run);
    const existingPreflight = await this.control.findRequestArtifact(
      run.runKey, request.requestKey, 'preflight'
    );
    const evaluation = existingPreflight === null
      ? await this.evidence.evaluate({
          run,
          plan,
          nowMs: request.acceptedAtMs,
          baselineRequired: true,
        })
      : preflightFromArtifact(existingPreflight);
    await this.control.recordPreflight({
      request,
      runKey: run.runKey,
      checks: evaluation.checks,
      dataQuality: evaluation.dataQuality,
      passed: evaluation.passed,
    });
    if (!evaluation.passed) {
      throw new SimulationControlError(
        'PREFLIGHT_FAILED',
        'baseline/arming preflight did not pass',
        evaluation
      );
    }
    await this.control.appendArtifact({
      request,
      runKey: run.runKey,
      kind: 'approval',
      payload: { ...approval, acknowledgedRiskClass: input.acknowledgedRiskClass },
    });
    if (run.state.status === 'scheduled') {
      run = await this.runs.transitionRun({
        runKey: run.runKey,
        event: eventFor(request, 'baseline', 'begin_baseline'),
        actor: request.actor,
      });
    }
    run = await this.runs.transitionRun({
      runKey: run.runKey,
      event: eventFor(request, 'armed', 'baseline_completed'),
      actor: request.actor,
    });
    return { run, preflight: evaluation, approval, idempotentReplay: false };
  }

  /**
   * The executor boundary. Refuses a live run that is not on the lab network,
   * before the executor exists, so wiring it in later cannot reach a run whose
   * target snapshot holds real fleet host identities. A dry run never reaches
   * this: it touches no host.
   */
  private assertExecutorNetwork(run: SimulationRunProjection): void {
    if (run.metadata.network !== EXECUTOR_LAB_NETWORK) {
      throw new SimulationControlError(
        'EXECUTOR_NETWORK_FORBIDDEN',
        `the executor runs only on ${EXECUTOR_LAB_NETWORK}; refusing a live ${run.metadata.network} run`,
        { network: run.metadata.network }
      );
    }
  }

  async start(input: { runKey: string; idempotencyKey: string }) {
    const request = await this.claim({
      operation: 'start', runKey: input.runKey, idempotencyKey: input.idempotencyKey, payload: {},
    });
    let run = await this.runs.loadRun(input.runKey);
    if (run.state.status === 'completed' && !run.state.live) return { run, idempotentReplay: true };
    ensureStatus(run, ['armed']);
    if (run.state.live) {
      this.assertExecutorNetwork(run);
      const plan = await this.loadPlan(run);
      // The lease is the run's own recovery envelope, from its immutable timing --
      // never wall-clock plus a Docker TTL. The frozen accept time is the fault start.
      const timing = deriveSimulationRunTiming(plan, run.state.createdAtMs);
      const faultLeaseExpiresAtMs = faultLeaseExpiresAtForStart(timing, request.acceptedAtMs);
      await this.executor.activateFault({ run, plan, faultLeaseExpiresAtMs });
      run = await this.runs.transitionRun({
        runKey: run.runKey,
        event: activateFaultEventFor(request, faultLeaseExpiresAtMs),
        actor: request.actor,
      });
      return { run, idempotentReplay: false };
    }
    run = await this.runs.transitionRun({
      runKey: run.runKey,
      event: eventFor(request, 'complete', 'dry_run_completed'),
      actor: request.actor,
    });
    return { run, idempotentReplay: false };
  }

  async abort(input: { runKey: string; idempotencyKey: string }) {
    const request = await this.claim({
      operation: 'abort', runKey: input.runKey, idempotencyKey: input.idempotencyKey, payload: {},
    });
    let run = await this.runs.loadRun(input.runKey);
    if (run.state.status === 'aborted') return { run, idempotentReplay: true };
    ensureStatus(run, ['draft', 'preflight', 'scheduled', 'baseline', 'armed', 'fault_active', 'observing', 'aborting', 'cooldown', 'recovery']);
    if (!run.state.abortRequested) {
      run = await this.runs.transitionRun({
        runKey: run.runKey,
        event: eventFor(request, 'abort', 'abort_requested'),
        actor: request.actor,
      });
    }
    if (run.state.status === 'aborting') {
      run = await this.runs.transitionRun({
        runKey: run.runKey,
        event: eventFor(request, 'recovery', 'begin_recovery'),
        actor: request.actor,
      });
    }
    if (run.state.live) {
      this.assertExecutorNetwork(run);
      // The run is already held in recovery above; the executor now clears the
      // fault and proves the lab is clean, and the outcome is recorded atomically.
      const recovery = await this.executor.proveRecovery({ run });
      run = await this.runs.recordRecoveryResult({
        runKey: run.runKey,
        event: recoveryOutcomeEventFor(request, recovery.allClear),
        recovery,
        actor: request.actor,
      });
      return { run, idempotentReplay: false };
    }
    run = await this.runs.transitionRun({
      runKey: run.runKey,
      event: eventFor(request, 'recovered', 'recovery_succeeded'),
      actor: request.actor,
    });
    return { run, idempotentReplay: false };
  }

  async recover(input: { runKey: string; idempotencyKey: string }) {
    const request = await this.claim({
      operation: 'recover', runKey: input.runKey, idempotencyKey: input.idempotencyKey, payload: {},
    });
    let run = await this.runs.loadRun(input.runKey);
    // Guard the network before touching a live run, but do not stop here: the
    // executor proves recovery below, once the run has reached `recovery`.
    if (run.state.live) this.assertExecutorNetwork(run);
    if (run.state.status !== 'recovery') {
      ensureStatus(run, ['armed', 'fault_active', 'observing', 'aborting', 'failed']);

      // Recovering a run that never executed is an abort, not a completion.
      //
      // recovery_succeeded resolves its terminal status from abortRequested
      // (`state.abortRequested ? 'aborted' : 'cooldown'`), and recover never set
      // it -- so a run that only ever reached `armed` came out `completed`, with
      // no dry_run_completed anywhere in its audit chain, claiming success for
      // work it had not done. For a dry run `armed` is the only attainable
      // status here, so that was every recover call, not an edge case.
      //
      // abort() sets the same intent for the same reason, and this mirrors it:
      // armed -> aborting -> recovery -> aborted.
      if (run.state.status === 'armed' && !run.state.abortRequested) {
        run = await this.runs.transitionRun({
          runKey: run.runKey,
          event: eventFor(request, 'abort', 'abort_requested'),
          actor: request.actor,
        });
      }

      run = await this.runs.transitionRun({
        runKey: run.runKey,
        event: eventFor(request, 'begin', 'begin_recovery'),
        actor: request.actor,
      });
    }
    if (run.state.live) {
      // The executor clears the fault and reports whether the lab came back clean;
      // the outcome and its findings are recorded atomically. A live run stops at
      // cooldown (or failed) -- its cooldown is a real budget, not auto-completed.
      const recovery = await this.executor.proveRecovery({ run });
      run = await this.runs.recordRecoveryResult({
        runKey: run.runKey,
        event: recoveryOutcomeEventFor(request, recovery.allClear),
        recovery,
        actor: request.actor,
      });
      return { run };
    }
    run = await this.runs.transitionRun({
      runKey: run.runKey,
      event: eventFor(request, 'success', 'recovery_succeeded'),
      actor: request.actor,
    });
    if (run.state.status === 'cooldown') {
      run = await this.runs.transitionRun({
        runKey: run.runKey,
        event: eventFor(request, 'complete', 'cooldown_completed'),
        actor: request.actor,
      });
    }
    return { run };
  }

  async status(runKey: string) {
    return this.runs.loadRun(runKey);
  }

  async history(runKey: string) {
    const [run, audit, artifacts] = await Promise.all([
      this.runs.loadRun(runKey),
      this.runs.listRunAudit(runKey),
      this.control.listArtifacts(runKey),
    ]);
    return { run, audit, artifacts };
  }
}
