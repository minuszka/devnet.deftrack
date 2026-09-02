import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { NetemFaultRunner } from './netemRunner.js';
import { dockerNetemExecutor, fileWrapperStore } from './netemWrapperHost.js';
import type { NetemSpec } from './netemLease.js';

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
const spec: NetemSpec = { container: CONTAINER, kind: 'latency', args: ['120ms'] };

async function docker(...args: string[]): Promise<string> {
  const { stdout } = await exec('docker', args);
  return stdout;
}

async function qdisc(): Promise<string> {
  return docker('exec', '-u', 'root', CONTAINER, 'tc', 'qdisc', 'show', 'dev', 'eth0');
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok: ${message}`);
}

async function main(): Promise<void> {
  await docker('rm', '-f', CONTAINER).catch(() => '');
  await docker('run', '-d', '--name', CONTAINER, '--cap-add', 'NET_ADMIN', IMAGE, 'sleep', '600');
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

    console.log('\nACCEPTANCE PASSED');
  } finally {
    await docker('rm', '-f', CONTAINER).catch(() => '');
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
