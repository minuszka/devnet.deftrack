import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SimulationTargetSnapshot } from '../models/SimulationRun.js';
import type { WrapperState } from './netemLease.js';
import type { RecoveryTargetEvidence } from './preflight.js';

/**
 * What the node-local wrapper publishes about itself, and how the preflight
 * reads it.
 *
 * The recovery-ready check needs three things it had no source for: that a
 * wrapper is alive at all, that it is the expected build, and that each target
 * it would have to recover is presently reachable and unfaulted. Hardcoding
 * those to "unknown" made every live run fail a `required` check by
 * construction -- fail-closed, but it silently disabled the whole live path and
 * blamed the targets for a server-side gap.
 *
 * The heartbeat is deliberately the wrapper's OWN claim, published on its own
 * cycle. It is the single owner of fault state, so "I hold no job for this
 * container" is the only authoritative answer to "is it clean"; anything the
 * server inferred by probing Docker itself would be a second opinion about a
 * record it does not own. Liveness is the file's timestamp, so a wrapper that
 * dies stops being fresh without having to announce it.
 */

export interface WrapperHeartbeatContainer {
  container: string;
  /** Docker's own view: the container exists and is running. */
  running: boolean;
  /** True when the wrapper holds no fault job against this container. */
  faultStateClean: boolean;
}

export interface WrapperHeartbeat {
  atMs: number;
  wrapperVersion: string;
  containers: WrapperHeartbeatContainer[];
}

/**
 * Build the heartbeat from what the wrapper knows. Pure.
 *
 * A container is reported clean when no job in the state names it -- of either
 * fault class, since a netem impairment and a stopped daemon are both faults a
 * run would have to recover from before it may start another.
 */
export function buildWrapperHeartbeat(input: {
  atMs: number;
  wrapperVersion: string;
  state: WrapperState;
  runningContainers: readonly string[];
}): WrapperHeartbeat {
  const held = new Set(input.state.jobs.map((job) => job.container));
  const names = new Set([...input.runningContainers, ...held]);
  return {
    atMs: input.atMs,
    wrapperVersion: input.wrapperVersion,
    containers: [...names].sort().map((container) => ({
      container,
      running: input.runningContainers.includes(container),
      faultStateClean: !held.has(container),
    })),
  };
}

/**
 * Turn a heartbeat into the preflight's recovery evidence, keyed by targetId.
 *
 * A target the heartbeat does not mention is simply absent from the result, and
 * the preflight already treats an unknown target as unrecoverable -- which is
 * the honest answer: a wrapper that has never seen the container cannot promise
 * to restore it. A missing heartbeat yields no worker and no targets at all, so
 * the check fails for the true reason rather than a hardcoded one.
 */
export function recoveryEvidenceFromHeartbeat(input: {
  heartbeat: WrapperHeartbeat | null;
  targets: readonly SimulationTargetSnapshot[];
}): { workerLastSeenAtMs: number | null; targets: RecoveryTargetEvidence[] } {
  if (input.heartbeat === null) return { workerLastSeenAtMs: null, targets: [] };
  const byContainer = new Map(input.heartbeat.containers.map((entry) => [entry.container, entry]));
  const targets: RecoveryTargetEvidence[] = [];
  for (const target of input.targets) {
    const entry = byContainer.get(target.hostRef);
    if (entry === undefined) continue;
    targets.push({
      targetId: target.targetId,
      available: entry.running,
      faultStateClean: entry.faultStateClean,
      wrapperVersion: input.heartbeat.wrapperVersion,
    });
  }
  return { workerLastSeenAtMs: input.heartbeat.atMs, targets };
}

/** Defensive parse: a truncated or half-written heartbeat reads as no heartbeat. */
export function parseWrapperHeartbeat(raw: unknown): WrapperHeartbeat | null {
  if (raw === null || typeof raw !== 'object') return null;
  const value = raw as Partial<WrapperHeartbeat>;
  if (!Number.isFinite(value.atMs) || typeof value.wrapperVersion !== 'string') return null;
  if (!Array.isArray(value.containers)) return null;
  const containers: WrapperHeartbeatContainer[] = [];
  for (const entry of value.containers) {
    if (entry === null || typeof entry !== 'object') continue;
    const item = entry as Partial<WrapperHeartbeatContainer>;
    if (typeof item.container !== 'string' || item.container.length === 0) continue;
    containers.push({
      container: item.container,
      running: item.running === true,
      faultStateClean: item.faultStateClean === true,
    });
  }
  return { atMs: value.atMs as number, wrapperVersion: value.wrapperVersion, containers };
}

/** Write-then-rename with a unique temp name, so a reader never sees a partial file. */
export async function writeWrapperHeartbeat(path: string, heartbeat: WrapperHeartbeat): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, `${JSON.stringify(heartbeat, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

/** Read a heartbeat, or null when there is none or it cannot be trusted. */
export async function readWrapperHeartbeat(path: string): Promise<WrapperHeartbeat | null> {
  try {
    return parseWrapperHeartbeat(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return null;
  }
}
