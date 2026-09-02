import { describe, expect, it } from 'vitest';
import {
  ContainerNotInLabProjectError,
  DockerLiveExecutor,
  type LabExecutorClock,
  type LabProbes,
} from './dockerLiveExecutor.js';
import { UnsupportedLiveFaultError } from './liveExecutorPlan.js';
import { serviceJobId } from './netemLease.js';
import type { CommandQueue } from './netemWrapperHost.js';
import type { PlannedActionPayload, PlannedSimulationAction, DryRunPlan } from './scenarioTypes.js';
import type { SimulationRunProjection } from '../services/simulationPersistence.service.js';
import type { SimulationTargetSnapshot } from '../models/SimulationRun.js';

class FakeQueue implements CommandQueue {
  enqueued: any[] = [];
  async enqueue(command: unknown): Promise<void> { this.enqueued.push(command); }
  async claim(): Promise<any[]> {
    return this.enqueued.splice(0).map((payload) => ({
      payload, attempts: 1,
      ack: async () => {}, retry: async () => {}, reject: async () => {},
    }));
  }
  async recoverInflight(): Promise<number> { return 0; }
}

class FakeClock implements LabExecutorClock {
  t = 1_000;
  delays: number[] = [];
  onDelay?: () => void;
  now(): number { return this.t; }
  async delay(ms: number): Promise<void> { this.delays.push(ms); this.t += ms; this.onDelay?.(); }
}

class FakeProbes implements LabProbes {
  clean = new Set<string>();
  serviceUp = new Set<string>();
  observerUp = new Set<string>();
  qdiscCalls: string[] = [];
  throwOn = new Set<string>();
  async qdiscClean(container: string): Promise<boolean> {
    this.qdiscCalls.push(container);
    if (this.throwOn.has(container)) throw new Error(`container ${container} is not running`);
    return this.clean.has(container);
  }
  async serviceRunning(container: string): Promise<boolean> { return this.serviceUp.has(container); }
  async observerFresh(input: { container: string }): Promise<boolean> { return this.observerUp.has(input.container); }
  projectOf = new Map<string, string | null>();
  async containerProject(container: string): Promise<string | null> {
    return this.projectOf.has(container) ? this.projectOf.get(container)! : LAB_PROJECT;
  }
}

const LAB_PROJECT = 'defcon-finality-lab';
/** Every executor in these tests is scoped to the lab project, as a real one must be. */
function mkExecutor(queue: CommandQueue, probes: LabProbes, clock: LabExecutorClock, opts: Record<string, unknown> = {}) {
  return new DockerLiveExecutor(queue, probes, clock, { allowedContainerProject: LAB_PROJECT, ...opts });
}

function target(overrides: Partial<SimulationTargetSnapshot> = {}): SimulationTargetSnapshot {
  return {
    targetId: 'mn-1', displayLabel: 'mn-1', operatorId: null, proTxHash: null, hostRef: 'mn01',
    unitRef: 'u', p2pPort: 19799, role: 'masternode', network: 'regtest',
    capabilities: ['netem-p2p', 'service-control'],
    expectedBuild: null, capturedAtMs: 0, capturedAtHeight: 0, ...overrides,
  };
}

function action(targetId: string, payload: PlannedActionPayload): PlannedSimulationAction {
  return { actionId: `${targetId}`, runKey: 'run-1', sequence: 0, targetId, kind: payload.kind, payload,
    payloadDigest: 'd', notBeforeOffsetMs: 0, expiresAfterMs: 60_000, maxAttempts: 1 };
}

const netemPayload: Extract<PlannedActionPayload, { kind: 'netem-apply' }> = {
  kind: 'netem-apply', interfaceRef: 'devnet-p2p', latencyMs: 100, jitterMs: 20, lossPercent: 5,
  correlationPercent: 25, faultLeaseSeconds: 200,
};
const stopPayload: PlannedActionPayload = { kind: 'service-stop', faultLeaseSeconds: 200 };
const partitionPayload: PlannedActionPayload = {
  kind: 'partition-apply', p2pPortRef: 'devnet-p2p', peerTargetIds: ['mn-2'], faultLeaseSeconds: 60,
};

function run(targets: SimulationTargetSnapshot[]): SimulationRunProjection {
  return { runKey: 'run-1', metadataFingerprint: 'fp', metadata: { targetSnapshot: targets }, state: {} } as unknown as SimulationRunProjection;
}
const planWith = (actions: PlannedSimulationAction[]): DryRunPlan => ({ actions } as unknown as DryRunPlan);

describe('DockerLiveExecutor.activateFault', () => {
  it('enqueues a composed apply with the lease as its TTL', async () => {
    const queue = new FakeQueue();
    const executor = mkExecutor(queue, new FakeProbes(), new FakeClock());
    await executor.activateFault({ run: run([target()]), plan: planWith([action('mn-1', netemPayload)]), faultLeaseExpiresAtMs: 31_000 });
    expect(queue.enqueued).toEqual([
      { op: 'apply', container: 'mn01', kind: 'netem', args: ['delay', '100ms', '20ms', 'loss', '5%', '25%'], runTag: 'run-1', ttlMs: 30_000 },
    ]);
  });

  it('enqueues a service outage as one stop under the same lease', async () => {
    const queue = new FakeQueue();
    const executor = mkExecutor(queue, new FakeProbes(), new FakeClock());
    await executor.activateFault({ run: run([target()]), plan: planWith([action('mn-1', stopPayload)]), faultLeaseExpiresAtMs: 31_000 });
    expect(queue.enqueued).toEqual([{ op: 'service-stop', container: 'mn01', runTag: 'run-1', ttlMs: 30_000 }]);
  });

  it('floors the TTL so an already-past lease still applies briefly', async () => {
    const queue = new FakeQueue();
    const executor = mkExecutor(queue, new FakeProbes(), new FakeClock(), { minLeaseMs: 1_000 });
    await executor.activateFault({ run: run([target()]), plan: planWith([action('mn-1', netemPayload)]), faultLeaseExpiresAtMs: 500 });
    expect((queue.enqueued[0] as { ttlMs: number }).ttlMs).toBe(1_000);
  });

  it('fails closed on a fault it cannot apply, enqueuing nothing', async () => {
    const queue = new FakeQueue();
    const executor = mkExecutor(queue, new FakeProbes(), new FakeClock());
    await expect(executor.activateFault({
      run: run([target()]), plan: planWith([action('mn-1', partitionPayload)]), faultLeaseExpiresAtMs: 31_000,
    })).rejects.toBeInstanceOf(UnsupportedLiveFaultError);
    expect(queue.enqueued).toEqual([]);
  });

  it('refuses a plan mixing both classes before enqueuing anything', async () => {
    const queue = new FakeQueue();
    const executor = mkExecutor(queue, new FakeProbes(), new FakeClock());
    await expect(executor.activateFault({
      run: run([target()]),
      plan: planWith([action('mn-1', netemPayload), action('mn-1', stopPayload)]),
      faultLeaseExpiresAtMs: 31_000,
    })).rejects.toBeInstanceOf(UnsupportedLiveFaultError);
    expect(queue.enqueued).toEqual([]);
  });
});

describe('DockerLiveExecutor.proveRecovery', () => {
  it('clears each fault, waits for the link to go clean, and reports all-clear', async () => {
    const queue = new FakeQueue();
    const clock = new FakeClock();
    const probes = new FakeProbes();
    probes.serviceUp.add('mn01'); probes.observerUp.add('mn01');
    // The link is still dirty on the first poll and goes clean after one wait.
    clock.onDelay = () => probes.clean.add('mn01');
    const executor = mkExecutor(queue, probes, clock, { recoveryPollIntervalMs: 500 });

    const result = await executor.proveRecovery({ run: run([target()]), plan: planWith([action('mn-1', netemPayload)]) });

    expect(queue.enqueued.filter((c) => c.op === 'clear')).toHaveLength(1);
    expect(clock.delays).toEqual([500]); // exactly one retry before it went clean
    expect(result.allClear).toBe(true);
    expect(result.targets).toEqual([
      { targetId: 'mn-1', faultStateClear: true, expectedServiceRunning: true, observerFresh: true, checkedAtMs: clock.t, privateDetail: null },
    ]);
  });

  it('clears a service outage by the stop job id and treats running again as clear', async () => {
    const queue = new FakeQueue();
    const clock = new FakeClock();
    const probes = new FakeProbes();
    // The container comes back only after one wait, and its daemon with it.
    clock.onDelay = () => { probes.serviceUp.add('mn01'); probes.observerUp.add('mn01'); };
    const executor = mkExecutor(queue, probes, clock, { recoveryPollIntervalMs: 500 });

    const result = await executor.proveRecovery({ run: run([target()]), plan: planWith([action('mn-1', stopPayload)]) });

    expect(queue.enqueued).toEqual([{ op: 'clear', jobId: serviceJobId('run-1', 'mn01') }]);
    expect(result.allClear).toBe(true);
    // For a service fault, "the fault is no longer in force" IS the container running.
    expect(result.targets[0]).toMatchObject({ faultStateClear: true, expectedServiceRunning: true, observerFresh: true });
  });

  it('waits for the daemon, not merely the container, before calling a stop recovered', async () => {
    const queue = new FakeQueue();
    const clock = new FakeClock();
    const probes = new FakeProbes();
    probes.serviceUp.add('mn01'); // container up from the start, daemon not yet
    clock.onDelay = () => probes.observerUp.add('mn01');
    const executor = mkExecutor(queue, probes, clock, { recoveryPollIntervalMs: 250 });

    await executor.proveRecovery({ run: run([target()]), plan: planWith([action('mn-1', stopPayload)]) });
    expect(clock.delays).toEqual([250]); // it did not accept the bare container
  });

  it('never asks a stopped container a question only a running one can answer', async () => {
    const queue = new FakeQueue();
    const probes = new FakeProbes(); // nothing running
    const executor = mkExecutor(queue, probes, new FakeClock(), { recoveryPollAttempts: 1 });
    const result = await executor.proveRecovery({ run: run([target()]), plan: planWith([action('mn-1', stopPayload)]) });
    expect(probes.qdiscCalls).toEqual([]); // no docker exec into a down container
    expect(result.allClear).toBe(false);
    expect(result.targets[0]).toMatchObject({ faultStateClear: false, expectedServiceRunning: false });
  });

  it('records a throwing probe as a finding instead of abandoning the recovery', async () => {
    const queue = new FakeQueue();
    const probes = new FakeProbes();
    probes.serviceUp.add('mn01'); probes.observerUp.add('mn01');
    probes.throwOn.add('mn01'); // the qdisc read rejects, as a docker exec can
    const executor = mkExecutor(queue, probes, new FakeClock(), { recoveryPollAttempts: 1, recoveryPollIntervalMs: 1 });
    const result = await executor.proveRecovery({ run: run([target()]), plan: planWith([action('mn-1', netemPayload)]) });
    expect(result.allClear).toBe(false);
    expect(result.targets[0]!.faultStateClear).toBe(false);
  });

  it('is not all-clear when a target is still faulted or its service is down', async () => {
    const queue = new FakeQueue();
    const probes = new FakeProbes();
    // mn01 recovers cleanly; mn02's link never goes clean.
    probes.clean.add('mn01');
    probes.serviceUp.add('mn01').add('mn02'); probes.observerUp.add('mn01').add('mn02');
    const executor = mkExecutor(queue, probes, new FakeClock(), { recoveryPollAttempts: 2, recoveryPollIntervalMs: 1 });
    const targets = [target({ targetId: 'mn-1', hostRef: 'mn01' }), target({ targetId: 'mn-2', hostRef: 'mn02' })];
    const plan = planWith([action('mn-1', netemPayload), action('mn-2', netemPayload)]);

    const result = await executor.proveRecovery({ run: run(targets), plan });

    expect(result.allClear).toBe(false);
    expect(result.targets.find((t) => t.targetId === 'mn-2')!.faultStateClear).toBe(false);
  });

  it('does not call an empty recovery all-clear -- leniency must not become a claim', async () => {
    const queue = new FakeQueue();
    const executor = mkExecutor(queue, new FakeProbes(), new FakeClock());
    const result = await executor.proveRecovery({ run: run([target()]), plan: planWith([action('mn-1', { kind: 'fault-clear', scope: 'run' })]) });
    expect(queue.enqueued).toEqual([]);
    expect(result.targets).toEqual([]);
    expect(result.required).toBe(false);
    expect(result.allClear).toBe(false);
  });

  it('refuses all-clear over a fault it could not speak for', async () => {
    const queue = new FakeQueue();
    const probes = new FakeProbes();
    probes.clean.add('mn01'); probes.serviceUp.add('mn01'); probes.observerUp.add('mn01');
    const executor = mkExecutor(queue, probes, new FakeClock(), { recoveryPollAttempts: 1 });
    const targets = [target({ targetId: 'mn-1', hostRef: 'mn01' }), target({ targetId: 'mn-2', hostRef: 'mn02' })];
    // mn-1 recovers; mn-2's partition is a class recovery cannot undo or verify.
    const plan = planWith([action('mn-1', netemPayload), action('mn-2', partitionPayload)]);
    const result = await executor.proveRecovery({ run: run(targets), plan });
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]!.faultStateClear).toBe(true);
    expect(result.allClear).toBe(false); // one skipped fault denies the whole run its all-clear
  });
});

describe('the executor may only touch the lab project', () => {
  it('refuses a container that belongs to another project, before enqueuing anything', async () => {
    // A declared hostRef becomes a container name verbatim, so without this any
    // container sharing the lab host could be declared as a target and stopped.
    const queue = new FakeQueue();
    const probes = new FakeProbes();
    probes.projectOf.set('mn01', 'somebody-elses-stack');
    const ex = mkExecutor(queue, probes, new FakeClock());
    await expect(ex.activateFault({
      run: run([target()]), plan: planWith([action('mn-1', netemPayload)]), faultLeaseExpiresAtMs: 31_000,
    })).rejects.toBeInstanceOf(ContainerNotInLabProjectError);
    expect(queue.enqueued).toEqual([]);
  });

  it('refuses a container that belongs to no project at all', async () => {
    const queue = new FakeQueue();
    const probes = new FakeProbes();
    probes.projectOf.set('mn01', null);
    await expect(mkExecutor(queue, probes, new FakeClock()).activateFault({
      run: run([target()]), plan: planWith([action('mn-1', netemPayload)]), faultLeaseExpiresAtMs: 31_000,
    })).rejects.toThrow(/not the lab project/);
  });

  it('refuses everything when no lab project is configured', async () => {
    // A lab that has not said which containers are its own must not guess.
    const queue = new FakeQueue();
    const ex = new DockerLiveExecutor(queue, new FakeProbes(), new FakeClock(), { allowedContainerProject: '' });
    await expect(ex.activateFault({
      run: run([target()]), plan: planWith([action('mn-1', netemPayload)]), faultLeaseExpiresAtMs: 31_000,
    })).rejects.toBeInstanceOf(ContainerNotInLabProjectError);
    expect(queue.enqueued).toEqual([]);
  });
});
