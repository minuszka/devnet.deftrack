import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { emptyWrapperState, parseWrapperState, type FaultAction, type WrapperState } from './netemLease.js';
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
export function dockerExecArgv(action: Extract<FaultAction, { tcArgs: string[] }>): string[] {
  return ['exec', '-u', 'root', action.container, 'tc', ...action.tcArgs];
}

/**
 * The docker argv for a service fault. The explicit `-t 30` replaces Docker's
 * 10-second SIGTERM-to-SIGKILL default: the node daemon is PID 1 with no init
 * shim, and a hard kill mid-write turns the restart into datadir recovery, which
 * reads as a slow rejoin and would quietly pollute every timing measured after it.
 */
const STOP_GRACE_SECONDS = 30;

export function dockerServiceArgv(action: Extract<FaultAction, { op: 'stop' | 'start' }>): string[] {
  return action.op === 'stop'
    ? ['stop', '-t', String(STOP_GRACE_SECONDS), action.container]
    : ['start', action.container];
}

/**
 * Whether a failure means "already in the wanted state" rather than "did not
 * happen". Benign only for an UNDO: a missing qdisc is the normal case for a
 * clear, and a stopped container has no network namespace at all, so "is not
 * running" likewise means the impairment is already gone.
 *
 * Nothing is benign for a `stop`, a `start` or an `apply`. Docker already exits 0
 * when a container is in the target state, so a non-zero exit there is a real
 * failure -- and "No such container" must never read as success for an apply, or
 * a fault that never landed would be recorded as active.
 */
function isBenignFailure(action: FaultAction, stderr: string): boolean {
  if (action.op !== 'clear') return false;
  return /No such file or directory|Cannot delete qdisc with handle of zero|RTNETLINK answers|is not running|No such container/i.test(
    stderr
  );
}

/**
 * Runs one fault action inside its container with `docker exec ... tc ...`. A
 * clear tolerates a container that has no netem qdisc, so re-clearing or clearing
 * a never-faulted node is not an error -- the same forgiveness the prototype got
 * from `2>/dev/null || true`, but scoped to the errors that actually mean "already
 * clear" rather than swallowing every failure.
 */
export function dockerFaultExecutor(dockerBin = 'docker'): FaultExecutor {
  return (action) => {
    const argv = action.op === 'stop' || action.op === 'start' ? dockerServiceArgv(action) : dockerExecArgv(action);
    return new Promise<void>((resolve, reject) => {
      const child = spawn(dockerBin, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) return resolve();
        if (isBenignFailure(action, stderr)) return resolve();
        reject(new Error(`docker ${argv.join(' ')} exited ${code ?? 'null'}: ${stderr.trim()}`));
      });
    });
  };
}

/** The pre-service name, so existing imports read unchanged. */
export { dockerFaultExecutor as dockerNetemExecutor };

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
        // Parsed defensively, not cast: a half-migrated or truncated record must
        // not decide whether the daemon -- and its watchdog -- comes up.
        return parseWrapperState(JSON.parse(await readFile(path, 'utf8')));
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return emptyWrapperState();
        throw error;
      }
    },
    async save(state: WrapperState): Promise<void> {
      await mkdir(dirname(path), { recursive: true });
      // Unique per write, as the command queue below already does. A shared
      // `.tmp` lets two concurrent writers truncate over each other and lets one
      // rename publish the other's bytes while its own save resolves successfully.
      const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
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
        let parsed: unknown;
        try {
          // Parse BEFORE deleting: a corrupt file must cost only itself. Throwing
          // here would discard every command already read in this batch, and a
          // lost service-stop is a node that never goes down -- or never comes up.
          parsed = JSON.parse(raw);
        } catch {
          await mkdir(join(dir, 'rejected'), { recursive: true });
          await rename(path, join(dir, 'rejected', name));
          continue;
        }
        await rm(path, { force: true });
        commands.push(parsed);
      }
      return commands;
    },
  };
}
