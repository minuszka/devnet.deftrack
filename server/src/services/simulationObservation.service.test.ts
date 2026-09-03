import { describe, expect, it, vi } from 'vitest';
import {
  measurementAnchorFor,
  SimulationObservationService,
  type ObservationSweepDeps,
} from './simulationObservation.service.js';

const TIP = { height: 1_050, hash: 'c'.repeat(64) };
const START = { height: 1_000, hash: 'a'.repeat(64) };
const END = { height: 1_012, hash: 'b'.repeat(64) };

function coded(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function harness(overrides: {
  state?: Record<string, unknown>;
  observationCandidates?: string[];
  finalizeCandidates?: string[];
  deps?: Partial<ObservationSweepDeps>;
  transitionRun?: ReturnType<typeof vi.fn>;
  finalize?: ReturnType<typeof vi.fn>;
} = {}) {
  const state = { status: 'fault_active', faultActivatedTip: START, ...overrides.state };
  const transitionRun = overrides.transitionRun ?? vi.fn(async () => ({ state }) as never);
  const finalize = overrides.finalize ?? vi.fn(async () => ({}));
  const measurement = { finalize: finalize as unknown as (input: never) => Promise<unknown> };
  const errors: string[] = [];
  const service = new SimulationObservationService(
    { loadRun: vi.fn(async () => ({ state }) as never), transitionRun } as never,
    measurement as never,
    {
      findObservationCandidates: async () => overrides.observationCandidates ?? [],
      findFinalizeCandidates: async () => overrides.finalizeCandidates ?? [],
      chainTip: async () => TIP,
      warmupBlocks: 2,
      clock: () => 5_000,
      logger: { info: () => {}, error: (m) => errors.push(m) },
      ...overrides.deps,
    }
  );
  return { service, transitionRun, finalize, errors };
}

describe('opening the observation window', () => {
  it('opens it once the warm-up blocks have passed', async () => {
    const h = harness({ observationCandidates: ['run-1'] });
    await h.service.tick();
    expect(h.transitionRun).toHaveBeenCalledTimes(1);
    const event = h.transitionRun.mock.calls[0]![0].event;
    expect(event.type).toBe('begin_observation');
    // Derived from the run, so a second sweep is refused as a reused id rather
    // than opening a second window.
    expect(event.eventId).toBe('observe:run-1');
  });

  it('waits while the chain is still inside the warm-up', async () => {
    // The blocks right after a fault lands are excluded by design: the network
    // is still reacting, and measuring them would attribute the reaction to the
    // steady state.
    const h = harness({
      observationCandidates: ['run-1'],
      state: { faultActivatedTip: { height: TIP.height - 1, hash: 'd'.repeat(64) } },
    });
    await h.service.tick();
    expect(h.transitionRun).not.toHaveBeenCalled();
  });

  it('leaves a run with no recorded start alone', async () => {
    // Armed before anchors existed: it cannot be placed against the chain, so it
    // is not moved on a height nobody observed.
    const h = harness({ observationCandidates: ['run-1'], state: { faultActivatedTip: undefined } });
    await h.service.tick();
    expect(h.transitionRun).not.toHaveBeenCalled();
    expect(h.errors).toEqual([]);
  });

  it('does not move a run that has left fault_active', async () => {
    const h = harness({ observationCandidates: ['run-1'], state: { status: 'recovery' } });
    await h.service.tick();
    expect(h.transitionRun).not.toHaveBeenCalled();
  });
});

describe('finalizing the measurement', () => {
  it('finalizes on the boundaries the run recorded', async () => {
    const h = harness({
      finalizeCandidates: ['run-1'],
      state: { status: 'cooldown', faultActivatedTip: START, recoveredTip: END },
    });
    await h.service.tick();
    expect(h.finalize).toHaveBeenCalledWith({
      runKey: 'run-1',
      anchor: {
        faultStartHeight: START.height,
        faultStartBlockHash: START.hash,
        faultEndHeight: END.height,
        faultEndBlockHash: END.hash,
      },
      generatedAtMs: 5_000,
    });
  });

  it('will not finalize on half a window', async () => {
    // One boundary invented is exactly the failure the anchors exist to stop.
    const h = harness({
      finalizeCandidates: ['run-1'],
      state: { status: 'cooldown', faultActivatedTip: START, recoveredTip: undefined },
    });
    await h.service.tick();
    expect(h.finalize).not.toHaveBeenCalled();
  });

  it('retries quietly while the evidence is still moving', async () => {
    // EVIDENCE_NOT_SETTLED is the measurement refusing to fingerprint a value the
    // pollers are still rewriting. That is the gate working, not a sweep failure
    // -- and the code is asserted here because it was first guessed wrong.
    const h = harness({
      finalizeCandidates: ['run-1'],
      state: { status: 'cooldown', faultActivatedTip: START, recoveredTip: END },
      finalize: vi.fn(async () => {
        throw coded('EVIDENCE_NOT_SETTLED');
      }),
    });
    await h.service.tick();
    expect(h.errors).toEqual([]);
  });

  it('records a run with nothing to measure once, as a finding, and moves on', async () => {
    // The anchors are immutable, so this refusal is permanent. Retrying it every
    // tick and logging an error each time -- which is what happened -- is noise
    // that hides real failures. It is recorded so the run is not offered again.
    const marked: unknown[] = [];
    const h = harness({
      finalizeCandidates: ['run-1'],
      state: { status: 'aborted', faultActivatedTip: START, recoveredTip: START },
      finalize: vi.fn(async () => {
        throw coded('WINDOW_UNMEASURABLE');
      }),
      deps: {
        markUnmeasurable: async (input) => {
          marked.push(input);
        },
      },
    });
    await h.service.tick();
    expect(marked).toEqual([{ runKey: 'run-1', reason: 'WINDOW_UNMEASURABLE', nowMs: 5_000 }]);
    expect(h.errors).toEqual([]);
  });

  it('reports a genuine failure and still runs the next candidate', async () => {
    const finalize = vi
      .fn()
      .mockRejectedValueOnce(new Error('mongo is down'))
      .mockResolvedValueOnce({});
    const h = harness({
      finalizeCandidates: ['run-1', 'run-2'],
      state: { status: 'cooldown', faultActivatedTip: START, recoveredTip: END },
      finalize,
    });
    await h.service.tick();
    expect(finalize).toHaveBeenCalledTimes(2);
    expect(h.errors.join(' ')).toMatch(/finalize for run-1 failed/);
  });
});

describe('the sweep itself', () => {
  it('moves nothing when the tip cannot be read', async () => {
    // No run may be advanced on a height nobody could confirm.
    const h = harness({
      observationCandidates: ['run-1'],
      finalizeCandidates: ['run-1'],
      deps: {
        chainTip: async () => {
          throw new Error('rpc unreachable');
        },
      },
    });
    await h.service.tick();
    expect(h.transitionRun).not.toHaveBeenCalled();
    expect(h.finalize).not.toHaveBeenCalled();
    expect(h.errors.join(' ')).toMatch(/observation sweep failed/);
  });

  it('does not start a second pass over the same candidates', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = harness({
      observationCandidates: ['run-1'],
      transitionRun: vi.fn(async () => {
        await gate;
        return {} as never;
      }),
    });
    const first = h.service.tick();
    await h.service.tick();
    release!();
    await first;
    expect(h.transitionRun).toHaveBeenCalledTimes(1);
  });
});

describe('measurementAnchorFor', () => {
  it('refuses a window that ends before it begins', () => {
    expect(measurementAnchorFor({ faultActivatedTip: END, recoveredTip: START })).toBeNull();
  });

  it('accepts a fault that began and ended in the same block', () => {
    expect(measurementAnchorFor({ faultActivatedTip: START, recoveredTip: START })).not.toBeNull();
  });
});
