import type { ChainAnchor } from '../domain/simulationRunState.js';
import type { SimulationAuditActor } from '../models/SimulationRun.js';
import type { SimulationMeasurementAnchor } from '../models/SimulationMeasurementReport.js';
import type { SimulationPersistenceService } from './simulationPersistence.service.js';

/** Just what the sweep needs to say, so a unit test runs without the logger's config. */
export interface ObservationLogger {
  info(message: string): void;
  error(message: string): void;
}

const SILENT_LOGGER: ObservationLogger = { info: () => {}, error: () => {} };

const INTERVAL_MS = 20_000;

const SWEEP_ACTOR: SimulationAuditActor = {
  actorId: 'observation-sweeper',
  actorType: 'system',
  displayName: 'Observation sweeper',
};

/** Reasons to leave a run for a later tick rather than treat the sweep as failed. */
function isSkippable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return (
    // Already done: the event id is derived from the run, so a repeat is refused
    // rather than opening a second window.
    code === 'EVENT_ID_REUSED' ||
    // Another writer moved the run under us, or this clock is behind its state.
    code === 'CONCURRENT_TRANSITION' ||
    code === 'STALE_EVENT' ||
    // The measurement's own gate: the rounds its verdict reads are still being
    // rewritten by the pollers, so finalizing now would fingerprint a value that
    // is going to change. Its code was guessed as NOT_SETTLED at first, and the
    // sweep then logged a working gate as a failure every tick -- the name is
    // EVIDENCE_NOT_SETTLED.
    code === 'EVIDENCE_NOT_SETTLED'
  );
}

export interface ObservationSweepDeps {
  /** Runs in fault_active, which may have reached their observation window. */
  findObservationCandidates(): Promise<string[]>;
  /** Runs whose fault is over and that have no measurement report yet. */
  findFinalizeCandidates(): Promise<string[]>;
  chainTip(): Promise<ChainAnchor>;
  /**
   * Records that a run can never be finalized, so it is not offered again.
   * Optional so a deployment without it keeps today's behaviour -- which is to
   * retry for ever, and is why this exists.
   */
  markUnmeasurable?(input: { runKey: string; reason: string; nowMs: number }): Promise<void>;
  /**
   * Records that a run's report now exists, so the candidate query can exclude
   * it rather than fetching it and filtering it out. Optional for the same
   * reason as above: a deployment without it keeps the old behaviour.
   */
  markReported?(input: { runKey: string; nowMs: number }): Promise<void>;
  /**
   * Blocks after the fault lands that are deliberately not measured, because the
   * network is still reacting to it. Observation begins once they have passed.
   */
  warmupBlocks: number;
  intervalMs?: number;
  clock?: () => number;
  logger?: ObservationLogger;
}

/**
 * Closes the loop between applying a fault and having measured it.
 *
 * Two steps existed on paper and nothing performed either. `observing` was a
 * declared state that no code ever entered, so every run went straight from
 * fault_active to recovery; and SimulationMeasurementService.finalize() had no
 * caller outside its own tests. The simulator could therefore carry a fault from
 * arming to cooldown and produce NO RESULT -- a chaos tool rather than an
 * instrument, and no basis at all for the repeatability check a scenario suite
 * is supposed to end with.
 *
 * Both steps are driven from the chain rather than from a timer, because both
 * are facts about heights:
 *
 * - Observation begins `warmupBlocks` after the fault landed. That is the window
 *   the measurement actually reads; the blocks before it are excluded by design.
 * - Finalizing needs the fault's two boundaries, height AND hash. Those became
 *   available only once the run began recording where the fault started and
 *   where recovery was proven, which is the likeliest reason nothing finalized
 *   before: there was no source for the hashes.
 *
 * Deliberately separate from the reconcile sweep. That one moves a run whose
 * lease or envelope expired -- it is about deadlines and safety. This one is
 * about evidence, and merging them would put a measurement failure in the path
 * that recovers a stuck fault.
 */
export class SimulationObservationService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  private readonly logger: ObservationLogger;
  private readonly clock: () => number;

  constructor(
    private readonly runs: Pick<SimulationPersistenceService, 'loadRun' | 'transitionRun'>,
    private readonly measurement: {
      finalize(input: {
        runKey: string;
        anchor: SimulationMeasurementAnchor;
        generatedAtMs: number;
      }): Promise<unknown>;
    },
    private readonly deps: ObservationSweepDeps
  ) {
    this.logger = deps.logger ?? SILENT_LOGGER;
    this.clock = deps.clock ?? Date.now;
  }

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.deps.intervalMs ?? INTERVAL_MS);
    this.logger.info(
      `Observation sweep started (warmup ${this.deps.warmupBlocks} block(s), every ${this.deps.intervalMs ?? INTERVAL_MS} ms)`
    );
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Exposed so a test can drive it without a timer. */
  async tick(): Promise<void> {
    // One pass at a time: a slow finalize must not have a second sweep running
    // the same candidates behind it.
    if (this.running) return;
    this.running = true;
    try {
      const tip = await this.deps.chainTip();
      await this.openObservationWindows(tip);
      await this.finalizeMeasurements();
    } catch (error) {
      // A tip that cannot be read ends this pass and nothing else. The next tick
      // tries again, and no run is moved on a height nobody could confirm.
      this.logger.error(`observation sweep failed: ${message(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async openObservationWindows(tip: ChainAnchor): Promise<void> {
    for (const runKey of await this.deps.findObservationCandidates()) {
      try {
        const run = await this.runs.loadRun(runKey);
        if (run.state.status !== 'fault_active') continue;
        const activated = run.state.faultActivatedTip;
        // No anchor means the run was armed before anchors were recorded. It
        // cannot be placed against the chain, so it is left where it is rather
        // than moved on a height nobody observed.
        if (activated === undefined) continue;
        if (tip.height < activated.height + this.deps.warmupBlocks) continue;
        await this.runs.transitionRun({
          runKey,
          event: { type: 'begin_observation', eventId: `observe:${runKey}`, atMs: this.clock() },
          actor: SWEEP_ACTOR,
        });
        this.logger.info(`${runKey} entered observation at height ${tip.height}`);
      } catch (error) {
        if (isSkippable(error)) continue;
        this.logger.error(`observation for ${runKey} failed: ${message(error)}`);
      }
    }
  }

  private async finalizeMeasurements(): Promise<void> {
    for (const runKey of await this.deps.findFinalizeCandidates()) {
      try {
        const run = await this.runs.loadRun(runKey);
        const anchor = measurementAnchorFor(run.state);
        // Both boundaries or none. A half-anchored report would name a window
        // with one end invented, which is the failure the anchors exist to stop.
        if (anchor === null) continue;
        await this.measurement.finalize({ runKey, anchor, generatedAtMs: this.clock() });
        if (this.deps.markReported !== undefined) {
          await this.deps.markReported({ runKey, nowMs: this.clock() });
        }
        this.logger.info(
          `${runKey} measurement finalized over [${anchor.faultStartHeight}, ${anchor.faultEndHeight}]`
        );
      } catch (error) {
        if (isSkippable(error)) continue;
        if ((error as { code?: string } | null)?.code === 'WINDOW_UNMEASURABLE') {
          // A finding, not a failure: the run's own boundaries leave nothing to
          // measure, and they cannot change. Recorded once so the run is not
          // offered again, and logged as information rather than as an error
          // repeating every tick for ever -- which is what it did.
          if (this.deps.markUnmeasurable !== undefined) {
            await this.deps.markUnmeasurable({ runKey, reason: message(error), nowMs: this.clock() });
          }
          this.logger.info(`${runKey} has nothing to measure and will not be finalized: ${message(error)}`);
          continue;
        }
        this.logger.error(`finalize for ${runKey} failed: ${message(error)}`);
      }
    }
  }
}

/** The measurement anchor a run's recorded boundaries imply, or null if it has none. */
export function measurementAnchorFor(state: {
  faultActivatedTip?: ChainAnchor;
  recoveredTip?: ChainAnchor;
}): SimulationMeasurementAnchor | null {
  const start = state.faultActivatedTip;
  const end = state.recoveredTip;
  if (start === undefined || end === undefined) return null;
  // A fault that "ended" before it began is not a window; refuse rather than
  // hand the measurement a range it would silently read as empty.
  if (end.height < start.height) return null;
  return {
    faultStartHeight: start.height,
    faultStartBlockHash: start.hash,
    faultEndHeight: end.height,
    faultEndBlockHash: end.hash,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
