import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { emptyWrapperState, type FaultAction, type WrapperState } from './netemLease.js';
import type { FaultExecutor, WrapperStore } from './netemRunner.js';

/**
 * The host-side glue for the node-local netem wrapper: the real docker/tc
 * executor and the file-backed state store the runner is injected with. Thin --
 * only the argv construction is pure and tested; the spawn and the filesystem are
 * exercised against a live lab, not in unit tests.
 */

/**
 * The docker argv that applies or clears a fault: `docker exec -u root <c> tc <args>`.
 * The node runs as a non-root user, but tc needs the container's NET_ADMIN
 * capability effective -- which only root has -- so the exec is explicitly root.
 * Pure.
 */
export function dockerExecArgv(action: FaultAction): string[] {
  return ['exec', '-u', 'root', action.container, 'tc', ...action.tcArgs];
}

/** A missing qdisc is the normal case for a clear -- there is simply nothing to delete. */
function isBenignClearError(stderr: string): boolean {
  return /No such file or directory|Cannot delete qdisc with handle of zero|RTNETLINK answers/i.test(stderr);
}

/**
 * Runs one fault action inside its container with `docker exec ... tc ...`. A
 * clear tolerates a container that has no netem qdisc, so re-clearing or clearing
 * a never-faulted node is not an error -- the same forgiveness the prototype got
 * from `2>/dev/null || true`, but scoped to the errors that actually mean "already
 * clear" rather than swallowing every failure.
 */
export function dockerNetemExecutor(dockerBin = 'docker'): FaultExecutor {
  return (action) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(dockerBin, dockerExecArgv(action), { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) return resolve();
        if (action.op === 'clear' && isBenignClearError(stderr)) return resolve();
        reject(new Error(`docker ${dockerExecArgv(action).join(' ')} exited ${code ?? 'null'}: ${stderr.trim()}`));
      });
    });
}

/**
 * A JSON-file wrapper store. Writes to a temp file and renames, so a crash mid-write
 * never leaves the state file half-written -- the recovery record must survive
 * exactly the kind of abrupt death the wrapper exists to recover from. A missing
 * file reads as the empty baseline.
 */
export function fileWrapperStore(path: string): WrapperStore {
  return {
    async load(): Promise<WrapperState> {
      try {
        return JSON.parse(await readFile(path, 'utf8')) as WrapperState;
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return emptyWrapperState();
        throw error;
      }
    },
    async save(state: WrapperState): Promise<void> {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      await rename(tmp, path);
    },
  };
}

/**
 * The orchestrator's channel to the single-owner wrapper: a directory of JSON
 * command files. The orchestrator enqueues; the wrapper drains and applies them,
 * so the wrapper stays the only writer of the fault state -- no second writer to
 * race. enqueue writes a temp file and renames, so the wrapper never reads a
 * half-written command.
 */
export interface CommandQueue {
  enqueue(command: unknown): Promise<void>;
  /** Decoded command payloads in submission order; the files are consumed. */
  drain(): Promise<unknown[]>;
}

export function fileCommandQueue(dir: string): CommandQueue {
  let seq = 0;
  return {
    async enqueue(command: unknown): Promise<void> {
      await mkdir(dir, { recursive: true });
      // Timestamp then a per-queue sequence, so two commands in the same
      // millisecond still drain in submission order; the random tail only breaks
      // ties between separate writers.
      const name = `${Date.now().toString().padStart(16, '0')}-${(seq++).toString().padStart(9, '0')}-${randomBytes(4).toString('hex')}.json`;
      const tmp = join(dir, `.${name}.tmp`);
      await writeFile(tmp, JSON.stringify(command), 'utf8');
      await rename(tmp, join(dir, name));
    },
    async drain(): Promise<unknown[]> {
      let names: string[];
      try {
        names = (await readdir(dir)).filter((entry) => entry.endsWith('.json')).sort();
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return [];
        throw error;
      }
      const commands: unknown[] = [];
      for (const name of names) {
        const path = join(dir, name);
        const raw = await readFile(path, 'utf8');
        await rm(path, { force: true });
        commands.push(JSON.parse(raw));
      }
      return commands;
    },
  };
}
