import type { SimulationAuditActor } from '../models/SimulationRun.js';
import type { SimulationPersistenceService } from './simulationPersistence.service.js';

/** Just what the sweep needs to say, so a unit test can run without the logger's config. */
export interface ReconcileLogger {
  info(message: string): void;
  error(message: string): void;
}

const SILENT_LOGGER: ReconcileLogger = { info: () => {}, error: () => {} };

const INTERVAL_MS = 15_000;

const SWEEP_ACTOR: SimulationAuditActor = {
  actorId: 'reconcile-sweeper',
  actorType: 'system',
  displayName: 'Reconcile sweeper',
};

/** Errors that mean "skip this run for now", not "the sweep failed". */
function isSkippable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  // STALE_EVENT: this process's clock is behind the run's last update, so the
  //   reconcile time predates the state -- another writer moved it more recently;
  //   leave it for a later tick. CONCURRENT_TRANSITION: it changed under us mid-CAS.
  return code === 'STALE_EVENT' || code === 'CONCURRENT_TRANSITION';
}

/**
 * Drives reconcilePersistedSimulationRun on a timer so a run whose fault lease or
 * envelope expired -- or that was mid-abort when the process died -- moves itself
 * into recovery without an operator. Nothing else ticks it: the reconcile that
 * runs inside loadRun is part of the audit replay, not a periodic sweep.
 *
 * One run's problem never stops the sweep: a stale or concurrently-moved run is
 * skipped, and any other error is logged and stepped over, so the next run and
 * the next tick still run. The candidate query is injected, so the sweep is
 * testable without a database.
 */
export class SimulationReconcileService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  private readonly logger: ReconcileLogger;

  constructor(
    private readonly persistence: Pick<SimulationPersistenceService, 'reconcileRun'>,
    private readonly findCandidates: (nowMs: number) => Promise<string[]>,
    private readonly options: { intervalMs?: number; clock?: () => number; logger?: ReconcileLogger } = {}
  ) {
    this.logger = options.logger ?? SILENT_LOGGER;
  }

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs ?? INTERVAL_MS);
    this.logger.info('Simulation reconcile sweep started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<{ reconciled: number; skipped: number }> {
    if (this.running) return { reconciled: 0, skipped: 0 };
    this.running = true;
    let reconciled = 0;
    let skipped = 0;
    try {
      const nowMs = (this.options.clock ?? Date.now)();
      const runKeys = await this.findCandidates(nowMs);
      for (const runKey of runKeys) {
        try {
          await this.persistence.reconcileRun({ runKey, nowMs, actor: SWEEP_ACTOR });
          reconciled++;
        } catch (error) {
          if (isSkippable(error)) {
            skipped++;
            continue;
          }
          this.logger.error(
            `Reconcile sweep failed for ${runKey}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Reconcile sweep tick failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.running = false;
    }
    return { reconciled, skipped };
  }
}
