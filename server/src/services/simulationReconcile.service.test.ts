import { describe, expect, it, vi } from 'vitest';
import { SimulationReconcileService } from './simulationReconcile.service.js';

class StaleError extends Error {
  code = 'STALE_EVENT' as const;
}

function service(reconcile: (runKey: string) => Promise<void>, candidates: string[]) {
  const persistence = {
    reconcileRun: vi.fn(async (input: { runKey: string }) => {
      await reconcile(input.runKey);
      return {} as never;
    }),
  };
  const sweep = new SimulationReconcileService(persistence, async () => candidates, { clock: () => 5_000 });
  return { sweep, persistence };
}

describe('SimulationReconcileService', () => {
  it('reconciles every candidate run once per tick', async () => {
    const { sweep, persistence } = service(async () => {}, ['sim_a', 'sim_b', 'sim_c']);
    const result = await sweep.tick();
    expect(result).toEqual({ reconciled: 3, skipped: 0 });
    expect(persistence.reconcileRun).toHaveBeenCalledTimes(3);
    expect(persistence.reconcileRun.mock.calls[0]![0]).toMatchObject({ runKey: 'sim_a', nowMs: 5_000 });
  });

  it('skips a stale run and still reconciles the rest', async () => {
    const { sweep } = service(async (runKey) => {
      if (runKey === 'sim_b') throw new StaleError('reconcile time predates the persisted run');
    }, ['sim_a', 'sim_b', 'sim_c']);
    const result = await sweep.tick();
    expect(result).toEqual({ reconciled: 2, skipped: 1 });
  });

  it('logs and steps over an unexpected error without stopping the sweep', async () => {
    const { sweep } = service(async (runKey) => {
      if (runKey === 'sim_a') throw new Error('boom');
    }, ['sim_a', 'sim_b']);
    const result = await sweep.tick();
    // sim_a failed (neither reconciled nor a skippable skip), sim_b reconciled.
    expect(result).toEqual({ reconciled: 1, skipped: 0 });
  });

  it('does not overlap ticks', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { sweep, persistence } = service(async () => { await gate; }, ['sim_a']);
    const first = sweep.tick();
    const second = await sweep.tick(); // returns immediately: a tick is already running
    expect(second).toEqual({ reconciled: 0, skipped: 0 });
    release();
    await first;
    expect(persistence.reconcileRun).toHaveBeenCalledTimes(1);
  });
});
