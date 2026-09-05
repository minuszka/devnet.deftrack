import { NetemFaultRunner, dispatchWrapperCommand, parseWrapperCommand, type RunnerLogger } from './netemRunner.js';
import {
  dockerNetemExecutor,
  dockerRunningContainers,
  fileCommandQueue,
  fileOutcomeStore,
  fileWrapperStore,
  MAX_COMMAND_ATTEMPTS,
  type CommandQueue,
  type OutcomeStore,
} from './netemWrapperHost.js';
import { buildWrapperHeartbeat, writeWrapperHeartbeat } from './wrapperHeartbeat.js';

/**
 * The node-local netem wrapper's process entrypoint.
 *
 * One process owns the fault state: it is the only writer, so the orchestrator's
 * applies and clears arrive as queued commands rather than concurrent file
 * writes, and there is no second writer to race. Each cycle drains the command
 * queue, applies each command, and runs the watchdog sweep -- so a fault clears
 * itself at its TTL whether or not the orchestrator is still alive.
 *
 *   node server/dist/simulator/netemWrapperMain.js
 *
 * Env: NETEM_WRAPPER_STATE (state file), NETEM_WRAPPER_COMMANDS (command dir),
 * NETEM_WRAPPER_INTERVAL_MS (cycle interval), DOCKER_BIN.
 */

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The command id straight off an unparsed payload.
 *
 * Used only on the rejection path, where the parse has already failed. Without
 * it a malformed command is quarantined silently and the orchestrator waits out
 * its whole timeout for an outcome that was never going to come.
 */
function commandIdOf(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null;
  const id = (payload as { commandId?: unknown }).commandId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * One wrapper cycle: apply everything queued, then sweep expired leases. A
 * malformed or failed command is logged and stepped over -- one bad command never
 * stops the queue or the watchdog. Pure of process concerns, so it is tested with
 * a fake runner and an in-memory queue.
 */
export async function runWrapperCycle(input: {
  runner: NetemFaultRunner;
  queue: CommandQueue;
  logger: RunnerLogger;
  /**
   * Publish liveness after the sweep. Optional, and its failure is logged and
   * stepped over: a heartbeat is what the preflight reads, never what the
   * recovery guarantee depends on, so it must not be able to break a cycle.
   */
  publish?: () => Promise<void>;
  /**
   * The clock the lease is judged against. The runner already takes one, and
   * the parse has to agree with it: they are both deciding whether the same
   * lease is still alive, and a cycle whose parse used wall time while its
   * planner used an injected clock could accept a command the planner would
   * then refuse. Defaults to the wall clock, which is what production uses.
   */
  clock?: () => number;
  /**
   * Where the wrapper says what it did with each command.
   *
   * Optional only so the fake-runner tests can leave it out; the real
   * entrypoint always passes one. Without it the orchestrator has no way to
   * learn that a command was refused, and records an enqueue as an applied
   * fault -- which is the whole reason this channel exists.
   */
  outcomes?: OutcomeStore;
}): Promise<{ dispatched: number; failed: number; cleared: number }> {
  const now = input.clock ?? Date.now;

  // Never lets a bookkeeping failure break a cycle: the recovery guarantee does
  // not depend on the outcome being written, and a wrapper that cannot write
  // one must still be able to clear faults.
  const record = async (
    commandId: string | null,
    status: 'applied' | 'rejected',
    detail: string | null
  ): Promise<void> => {
    if (input.outcomes === undefined || commandId === null) return;
    try {
      await input.outcomes.record({ commandId, status, jobId: null, detail, atMs: now() });
    } catch (error) {
      input.logger.error(`outcome for ${commandId} could not be recorded: ${message(error)}`);
    }
  };
  let dispatched = 0;
  let failed = 0;
  for (const claimed of await input.queue.claim()) {
    let command;
    try {
      command = parseWrapperCommand(claimed.payload, now());
    } catch (error) {
      // Malformed: no number of retries will make it parse, so it is quarantined
      // rather than left to circle. The id is read straight off the raw payload,
      // because the parse that would have given it to us is the thing that
      // failed -- and a refusal nobody can attribute is a refusal nobody sees.
      failed++;
      await record(commandIdOf(claimed.payload), 'rejected', message(error));
      await claimed.reject(String(error));
      input.logger.error(`wrapper command rejected: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    try {
      await dispatchWrapperCommand(input.runner, command);
      // Acked only once it has actually been applied. The command file survives
      // a crash in between and is re-claimed at the next boot; every command the
      // wrapper takes is idempotent, so arriving twice costs nothing while
      // arriving zero times leaves a node stopped that nothing will start.
      await record(command.commandId, 'applied', null);
      await claimed.ack();
      dispatched++;
    } catch (error) {
      failed++;
      // Recorded only once the queue has given up on it. A retry is not an
      // outcome, and writing one would tell the orchestrator a fault had failed
      // while the wrapper was still going to apply it.
      if (claimed.attempts >= MAX_COMMAND_ATTEMPTS) {
        await record(command.commandId, 'rejected', message(error));
      }
      await claimed.retry();
      input.logger.error(
        `wrapper command failed (attempt ${claimed.attempts}): ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  const { cleared } = await input.runner.tick();
  if (input.publish !== undefined) {
    try {
      await input.publish();
    } catch (error) {
      input.logger.error(`heartbeat publish failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { dispatched, failed, cleared };
}

async function main(): Promise<void> {
  const statePath = process.env.NETEM_WRAPPER_STATE ?? '/var/lib/netem-wrapper/state.json';
  const commandDir = process.env.NETEM_WRAPPER_COMMANDS ?? '/var/lib/netem-wrapper/commands';
  const intervalMs = Number(process.env.NETEM_WRAPPER_INTERVAL_MS ?? 5_000);
  const heartbeatPath = process.env.NETEM_WRAPPER_HEARTBEAT ?? '';
  const wrapperVersion = process.env.NETEM_WRAPPER_VERSION ?? '';
  const logger: RunnerLogger = { info: (m) => console.info(m), error: (m) => console.error(m) };

  const runner = new NetemFaultRunner(dockerNetemExecutor(process.env.DOCKER_BIN ?? 'docker'), fileWrapperStore(statePath), {
    logger,
  });
  const queue = fileCommandQueue(commandDir);
  // Beside the queue, so one directory carries the whole conversation:
  // what the orchestrator asked for, and what the wrapper did about it.
  const outcomes = fileOutcomeStore(commandDir);

  // The wrapper's own claim about itself, which is what the live preflight reads.
  // Unset means it publishes nothing, and a live run then fails recovery-ready --
  // fail-closed for the true reason, rather than because the evidence was
  // hardcoded to "unknown".
  const runningContainers = dockerRunningContainers(process.env.DOCKER_BIN ?? 'docker');
  const publish =
    heartbeatPath === ''
      ? undefined
      : async (): Promise<void> => {
          await writeWrapperHeartbeat(
            heartbeatPath,
            buildWrapperHeartbeat({
              atMs: Date.now(),
              wrapperVersion,
              state: await runner.snapshot(),
              runningContainers: await runningContainers(),
            })
          );
        };

  // Arm the cycle FIRST. Boot recovery is the moment the guarantee is needed most,
  // so nothing it does may decide whether the watchdog runs: a state file naming a
  // stopped container must never be able to kill the daemon that would restart it.
  let stopping = false;
  // One cycle at a time. The runner serialises its own operations, so an overlap
  // could no longer corrupt the record -- but a `docker stop -t 30` outlasts six
  // 5-second ticks, and without this the queued cycles simply pile up behind it.
  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    void runWrapperCycle({ runner, queue, logger, publish, outcomes })
      .catch((error) => {
        logger.error(`wrapper cycle failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);
  logger.info(`lab fault wrapper watching ${commandDir}, state ${statePath}`);

  // Then recover: after a crash the real state is unknown, so undo every recorded
  // job. It never rejects; anything it could not undo is retained as expired and
  // the next cycle retries it.
  // Anything a crash stranded mid-application goes back to pending before the
  // first cycle claims.
  const requeued = await queue.recoverInflight();
  if (requeued > 0) logger.info(`returned ${requeued} in-flight command(s) to pending`);

  const recovered = await runner.bootCleanup();
  logger.info(`boot recovery undid ${recovered.cleared}, retained ${recovered.failed}`);

  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info(`${signal} received, netem wrapper stopping`);
    clearInterval(timer);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Only run as an entrypoint, not when imported by a test.
if (process.argv[1] && process.argv[1].endsWith('netemWrapperMain.js')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
