import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { NetemFaultRunner, type RunnerLogger } from './netemRunner.js';
import { dockerNetemExecutor, fileCommandQueue, fileWrapperStore } from './netemWrapperHost.js';
import { runWrapperCycle } from './netemWrapperMain.js';
import { DockerLiveExecutor, dockerLabProbes, systemLabClock } from './dockerLiveExecutor.js';
import type { NetemSpec } from './netemLease.js';
import type { SimulationRunProjection } from '../services/simulationPersistence.service.js';
import type { DryRunPlan } from './scenarioTypes.js';

/**
 * The day-8 acceptance gate, against a live container: a fault clears itself with
 * nothing but the node-local wrapper -- no orchestrator, no Mongo. Run manually
 * with a working Docker daemon; it is not part of `npm test`.
 *
 *   npx tsx server/src/simulator/labAcceptance.ts
 *
 * It uses the real runner and the real `docker exec -u root ... tc` executor
 * against a real qdisc; only the clock is injected, so the TTL is exercised
 * deterministically instead of by sleeping.
 */

const exec = promisify(execFile);
const CONTAINER = 'lab-accept';
const IMAGE = process.env.DEFCON_IMAGE ?? 'defcon-core:test';
const TTL_MS = 30_000;
// The executor refuses any container outside its own Compose project, so the
// acceptance container carries the label a real lab node would. Exercising the
// guard rather than stepping around it is the point.
const LAB_PROJECT = 'defcon-finality-lab';
const spec: NetemSpec = { container: CONTAINER, kind: 'latency', args: ['120ms'] };

async function docker(...args: string[]): Promise<string> {
  const { stdout } = await exec('docker', args);
  return stdout;
}

async function qdisc(): Promise<string> {
  return docker('exec', '-u', 'root', CONTAINER, 'tc', 'qdisc', 'show', 'dev', 'eth0');
}

/** Docker's own view, which answers for a stopped container as well as a running one. */
async function running(): Promise<boolean> {
  return (await docker('inspect', '-f', '{{.State.Running}}', CONTAINER)).trim() === 'true';
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok: ${message}`);
}

const silent: RunnerLogger = { info: () => {}, error: () => {} };

async function main(): Promise<void> {
  await docker('rm', '-f', CONTAINER).catch(() => '');
  await docker(
    'run', '-d', '--name', CONTAINER,
    '--label', `com.docker.compose.project=${LAB_PROJECT}`,
    '--cap-add', 'NET_ADMIN', IMAGE, 'sleep', '600'
  );
  const dir = await mkdtemp(join(tmpdir(), 'lab-accept-'));
  try {
    let now = 1_000;
    const runner = new NetemFaultRunner(dockerNetemExecutor(), fileWrapperStore(join(dir, 'state.json')), {
      clock: () => now,
    });

    console.log('1. node-local recovery after the orchestrator is gone');
    await runner.apply(spec, 'accept-run', TTL_MS);
    // tc prints e.g. "qdisc netem 8003: root refcnt 17 limit 1000 delay 120ms".
    assert((await qdisc()).includes('delay 120ms'), 'the fault is applied to the container');
    // The orchestrator is now dead -- nothing but the wrapper's own watchdog runs.
    now += TTL_MS + 1;
    const swept = await runner.tick();
    assert(swept.cleared === 1, 'the watchdog cleared the expired lease on its own clock');
    assert(!(await qdisc()).includes('netem'), 'the container link is clean again');

    console.log('2. explicit abort clears the fault');
    now += 1;
    await runner.apply(spec, 'accept-run', TTL_MS);
    assert((await qdisc()).includes('delay 120ms'), 'a second fault is applied');
    const { jobId } = await runner.apply(spec, 'accept-run', TTL_MS); // idempotent id
    await runner.clear(jobId);
    assert(!(await qdisc()).includes('netem'), 'abort cleared the link');

    console.log('3. the deployable daemon path: queued command -> tc -> watchdog');
    const queue = fileCommandQueue(join(dir, 'commands'));
    now += 1;
    await queue.enqueue({ op: 'apply', container: CONTAINER, kind: 'latency', args: ['80ms'], runTag: 'accept-run', ttlMs: TTL_MS });
    const applied = await runWrapperCycle({ runner, queue, logger: silent });
    assert(applied.dispatched === 1, 'the cycle dispatched the queued apply');
    assert((await qdisc()).includes('delay 80ms'), 'a queued command applied the fault through the wrapper');
    // Orchestrator gone again -- only the daemon's own cycle runs the watchdog.
    now += TTL_MS + 1;
    const daemonSwept = await runWrapperCycle({ runner, queue, logger: silent });
    assert(daemonSwept.cleared === 1, 'the daemon cycle watchdog cleared the queued fault');
    assert(!(await qdisc()).includes('netem'), 'the link is clean after the daemon watchdog');

    console.log('4. the live executor drives the real queue, wrapper and probes');
    // The deployable topology: a background wrapper daemon draining a shared
    // command queue, and the control-service executor speaking only to that queue.
    const liveRunner = new NetemFaultRunner(dockerNetemExecutor(), fileWrapperStore(join(dir, 'live-state.json')));
    const liveQueue = fileCommandQueue(join(dir, 'live-commands'));
    const wrapperTimer = setInterval(() => {
      void runWrapperCycle({ runner: liveRunner, queue: liveQueue, logger: { info: () => {}, error: () => {} } }).catch(() => {});
    }, 250);
    try {
      const realProbes = dockerLabProbes();
      // observerFresh wants a real daemon (docker top defcond); this container runs
      // sleep, so stand it in with the running-state probe -- the netem path is what
      // section 4 proves, and faultStateClear is read from the real qdisc regardless.
      const probes = { ...realProbes, observerFresh: (i: { container: string }) => realProbes.serviceRunning(i.container) };
      const executor = new DockerLiveExecutor(liveQueue, probes, systemLabClock, { recoveryPollIntervalMs: 300, recoveryPollAttempts: 20, allowedContainerProject: LAB_PROJECT });

      const labRun = {
        runKey: 'accept-live', metadataFingerprint: 'fp',
        metadata: { targetSnapshot: [{ targetId: 'mn-1', hostRef: CONTAINER, network: 'regtest', capabilities: ['netem-p2p'] }] },
        state: {},
      } as unknown as SimulationRunProjection;
      const labPlan = {
        actions: [{
          targetId: 'mn-1', payload: { kind: 'netem-apply', interfaceRef: 'devnet-p2p', latencyMs: 90, jitterMs: 0, lossPercent: 0, correlationPercent: 0, faultLeaseSeconds: 600 },
        }],
      } as unknown as DryRunPlan;

      await executor.activateFault({ run: labRun, plan: labPlan, faultLeaseExpiresAtMs: Date.now() + 600_000 });
      await waitFor(async () => (await qdisc()).includes('delay 90ms'), 8_000);
      assert((await qdisc()).includes('delay 90ms'), 'the executor applied the fault through the real queue and wrapper');

      const recovery = await executor.proveRecovery({ run: labRun, plan: labPlan });
      assert(recovery.allClear, 'the executor proved recovery clean');
      assert(recovery.targets[0]?.faultStateClear === true, 'recovery read the real qdisc back to clean');
      assert(!(await qdisc()).includes('netem'), 'the link is clean after the executor recovery');
    } finally {
      clearInterval(wrapperTimer);
    }

    console.log('5. the day-8 gate: a STOPPED container comes back with no orchestrator');
    // A forgotten qdisc is a slow node; a forgotten stop is a dead masternode.
    // Every part below runs with the orchestrator absent by construction: nothing
    // but the wrapper's own record and its own clock is in the loop.
    let svcNow = 1_000;
    const svcStore = fileWrapperStore(join(dir, 'service-state.json'));
    const svcQueue = fileCommandQueue(join(dir, 'service-commands'));
    const svcRunner = () => new NetemFaultRunner(dockerNetemExecutor(), svcStore, { clock: () => svcNow });

    // 5a -- the TTL restores it, with nothing else running.
    await svcQueue.enqueue({ op: 'service-stop', container: CONTAINER, runTag: 'accept-svc', ttlMs: TTL_MS });
    const stopCycle = await runWrapperCycle({ runner: svcRunner(), queue: svcQueue, logger: silent });
    assert(stopCycle.dispatched === 1, 'the queued service-stop was dispatched');
    assert((await running()) === false, 'the container is stopped');
    svcNow += TTL_MS + 1;
    const ttlCycle = await runWrapperCycle({ runner: svcRunner(), queue: svcQueue, logger: silent });
    assert(ttlCycle.cleared === 1, 'the watchdog restored the container on its own clock');
    assert((await running()) === true, 'the container is running again after the TTL alone');

    // 5b -- the WRAPPER died mid-fault: a fresh process restores from the record.
    svcNow += 1;
    await svcRunner().stopService(CONTAINER, 'accept-svc', TTL_MS);
    assert((await running()) === false, 'a second stop landed');
    const reborn = await svcRunner().bootCleanup(); // a brand-new process over the same state file
    assert(reborn.cleared === 1 && reborn.failed === 0, 'boot recovery undid the stop it found recorded');
    assert((await running()) === true, 'the container is up again, restored from the record not the TTL');
    assert((await svcStore.load()).jobs.length === 0, 'the record is clean afterwards');

    // 5c/5d -- a failing undo is retained and never blocks another container's.
    svcNow += 1;
    await svcRunner().stopService(CONTAINER, 'accept-svc', TTL_MS);
    const ghost = await svcStore.load();
    ghost.jobs.push({
      jobId: 'service-ghost', runTag: 'accept-svc', container: 'lab-accept-does-not-exist',
      faultClass: 'service', kind: 'service-stop', args: [], appliedAtMs: svcNow, expiresAtMs: svcNow + TTL_MS,
    });
    await svcStore.save(ghost);
    const mixed = await svcRunner().bootCleanup();
    assert(mixed.cleared === 1 && mixed.failed === 1, 'the reachable container was restored despite the unreachable one');
    assert((await running()) === true, 'no head-of-line block: the real container came back');
    const retained = (await svcStore.load()).jobs;
    assert(retained.length === 1 && retained[0]!.container === 'lab-accept-does-not-exist', 'only the failure is retained');
    assert(retained[0]!.expiresAtMs === 0, 'the retained job is already expired, so the next tick retries it forever');

    console.log('\nACCEPTANCE PASSED');
  } finally {
    await docker('rm', '-f', CONTAINER).catch(() => '');
    await rm(dir, { recursive: true, force: true });
  }
}

/** Poll a predicate until true or the deadline; the lab is asynchronous. */
async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
