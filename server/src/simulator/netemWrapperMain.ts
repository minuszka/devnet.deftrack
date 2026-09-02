import { NetemFaultRunner, dispatchWrapperCommand, parseWrapperCommand, type RunnerLogger } from './netemRunner.js';
import { dockerNetemExecutor, fileCommandQueue, fileWrapperStore, type CommandQueue } from './netemWrapperHost.js';

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
}): Promise<{ dispatched: number; failed: number; cleared: number }> {
  let dispatched = 0;
  let failed = 0;
  for (const raw of await input.queue.drain()) {
    try {
      await dispatchWrapperCommand(input.runner, parseWrapperCommand(raw));
      dispatched++;
    } catch (error) {
      failed++;
      input.logger.error(`wrapper command rejected: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const { cleared } = await input.runner.tick();
  return { dispatched, failed, cleared };
}

async function main(): Promise<void> {
  const statePath = process.env.NETEM_WRAPPER_STATE ?? '/var/lib/netem-wrapper/state.json';
  const commandDir = process.env.NETEM_WRAPPER_COMMANDS ?? '/var/lib/netem-wrapper/commands';
  const intervalMs = Number(process.env.NETEM_WRAPPER_INTERVAL_MS ?? 5_000);
  const logger: RunnerLogger = { info: (m) => console.info(m), error: (m) => console.error(m) };

  const runner = new NetemFaultRunner(dockerNetemExecutor(process.env.DOCKER_BIN ?? 'docker'), fileWrapperStore(statePath), {
    logger,
  });
  const queue = fileCommandQueue(commandDir);

  // Arm the cycle FIRST. Boot recovery is the moment the guarantee is needed most,
  // so nothing it does may decide whether the watchdog runs: a state file naming a
  // stopped container must never be able to kill the daemon that would restart it.
  let stopping = false;
  const timer = setInterval(() => {
    void runWrapperCycle({ runner, queue, logger }).catch((error) => {
      logger.error(`wrapper cycle failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, intervalMs);
  logger.info(`lab fault wrapper watching ${commandDir}, state ${statePath}`);

  // Then recover: after a crash the real state is unknown, so undo every recorded
  // job. It never rejects; anything it could not undo is retained as expired and
  // the next cycle retries it.
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
