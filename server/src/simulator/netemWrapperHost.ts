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
 * The container names Docker currently reports as running. One cheap call per
 * heartbeat; a failure answers "none", which reads downstream as "not available"
 * rather than as a false all-clear.
 */
export function dockerRunningContainers(dockerBin = 'docker'): () => Promise<string[]> {
  return () =>
    new Promise<string[]>((resolve) => {
      const child = spawn(dockerBin, ['ps', '--format', '{{.Names}}'], { stdio: ['ignore', 'pipe', 'ignore'] });
      let stdout = '';
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.on('error', () => resolve([]));
      child.on('close', (code) => {
        if (code !== 0) return resolve([]);
        resolve(stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0));
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
 * command files, claimed rather than consumed.
 *
 * The first version read a file, DELETED it, and only then handed the command on
 * to be applied. A crash in that gap lost the command outright while the
 * orchestrator had already recorded the fault as active -- at-most-once delivery
 * for an instruction that must land. With several targets it could also leave a
 * fault half-applied across the set.
 *
 * A command now moves pending -> inflight -> gone, by rename, and is removed only
 * once the wrapper says it was applied. A crash leaves it in `inflight`, and boot
 * returns it to `pending` instead of forgetting it.
 *
 * That makes delivery AT-LEAST-once, which is sound here for a specific reason
 * rather than by hope: every command the wrapper takes is idempotent. Re-applying
 * a live netem job is a no-op (planApply), clearing an absent one is a no-op
 * (planClear), and `docker stop`/`docker start` both exit 0 when the container is
 * already in the wanted state. Delivering twice costs nothing; delivering zero
 * times leaves a node stopped that nothing will start.
 */
export interface ClaimedCommand {
  /** The decoded payload. Validation is the caller's job, as before. */
  payload: unknown;
  /** How many times this command has already been attempted. */
  attempts: number;
  /** Applied: remove it for good. */
  ack(): Promise<void>;
  /** Not applied, but might be next time: return it to pending. */
  retry(): Promise<void>;
  /** It can never be applied: quarantine it with the reason. */
  reject(reason: string): Promise<void>;
}

export interface CommandQueue {
  enqueue(command: unknown): Promise<void>;
  /**
   * Take the pending commands in submission order, moving each to `inflight`.
   * Each must be acked, retried or rejected; anything left behind is recovered
   * at the next boot.
   */
  claim(): Promise<ClaimedCommand[]>;
  /** Return whatever a crash stranded in `inflight` to `pending`. */
  recoverInflight(): Promise<number>;
}

/** Attempts beyond this and the command is quarantined rather than retried for ever. */
export const MAX_COMMAND_ATTEMPTS = 5;

interface CommandEnvelope {
  attempts: number;
  command: unknown;
}

function parseEnvelope(raw: string): CommandEnvelope {
  const value: unknown = JSON.parse(raw);
  if (value !== null && typeof value === 'object' && 'command' in value && 'attempts' in value) {
    const envelope = value as { attempts: unknown; command: unknown };
    return {
      attempts: Number.isSafeInteger(envelope.attempts) ? (envelope.attempts as number) : 0,
      command: envelope.command,
    };
  }
  // A bare payload: written before the envelope existed, or by hand.
  return { attempts: 0, command: value };
}

export function fileCommandQueue(dir: string): CommandQueue {
  let seq = 0;
  const pendingDir = join(dir, 'pending');
  const inflightDir = join(dir, 'inflight');
  const rejectedDir = join(dir, 'rejected');

  async function writeEnvelope(target: string, name: string, envelope: CommandEnvelope): Promise<void> {
    await mkdir(target, { recursive: true });
    const tmp = join(target, `.${name}.tmp`);
    await writeFile(tmp, JSON.stringify(envelope), 'utf8');
    await rename(tmp, join(target, name));
  }

  async function names(target: string): Promise<string[]> {
    try {
      return (await readdir(target)).filter((entry) => entry.endsWith('.json')).sort();
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return [];
      throw error;
    }
  }

  return {
    async enqueue(command: unknown): Promise<void> {
      // Timestamp then a per-queue sequence, so two commands in the same
      // millisecond still claim in submission order; the random tail only breaks
      // ties between separate writers.
      const name = `${Date.now().toString().padStart(16, '0')}-${(seq++).toString().padStart(9, '0')}-${randomBytes(4).toString('hex')}.json`;
      await writeEnvelope(pendingDir, name, { attempts: 0, command });
    },

    async claim(): Promise<ClaimedCommand[]> {
      const claimed: ClaimedCommand[] = [];
      for (const name of await names(pendingDir)) {
        const from = join(pendingDir, name);
        let envelope: CommandEnvelope;
        try {
          // Parse BEFORE moving: a corrupt file must cost only itself, never the
          // batch beside it.
          envelope = parseEnvelope(await readFile(from, 'utf8'));
        } catch {
          await mkdir(rejectedDir, { recursive: true });
          await rename(from, join(rejectedDir, name));
          continue;
        }
        await mkdir(inflightDir, { recursive: true });
        const inflight = join(inflightDir, name);
        try {
          await rename(from, inflight);
        } catch {
          continue; // another claimer took it
        }
        // Persist the attempt BEFORE handing it over, so a command that kills the
        // wrapper every time is counted each time and eventually quarantined
        // instead of being recovered for ever.
        const attempts = envelope.attempts + 1;
        await writeFile(inflight, JSON.stringify({ attempts, command: envelope.command }), 'utf8');
        claimed.push({
          payload: envelope.command,
          attempts,
          async ack(): Promise<void> {
            await rm(inflight, { force: true });
          },
          async retry(): Promise<void> {
            if (attempts >= MAX_COMMAND_ATTEMPTS) {
              await mkdir(rejectedDir, { recursive: true });
              await rename(inflight, join(rejectedDir, name));
              return;
            }
            await writeEnvelope(pendingDir, name, { attempts, command: envelope.command });
            await rm(inflight, { force: true });
          },
          async reject(): Promise<void> {
            await mkdir(rejectedDir, { recursive: true });
            await rename(inflight, join(rejectedDir, name));
          },
        });
      }
      return claimed;
    },

    async recoverInflight(): Promise<number> {
      const stranded = await names(inflightDir);
      let requeued = 0;
      for (const name of stranded) {
        const from = join(inflightDir, name);
        let attempts = 0;
        try {
          attempts = parseEnvelope(await readFile(from, 'utf8')).attempts;
        } catch {
          attempts = MAX_COMMAND_ATTEMPTS; // unreadable: quarantine rather than loop
        }
        if (attempts >= MAX_COMMAND_ATTEMPTS) {
          await mkdir(rejectedDir, { recursive: true });
          await rename(from, join(rejectedDir, name)).catch(() => {});
          continue;
        }
        await mkdir(pendingDir, { recursive: true });
        await rename(from, join(pendingDir, name)).catch(() => {});
        requeued++;
      }
      return requeued;
    },
  };
}
