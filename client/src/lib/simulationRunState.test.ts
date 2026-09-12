import { describe, expect, it } from 'vitest';
import type { SimulationControlRun, SimulationPreflight } from './admin-api.js';
import {
  SelectedRunStore,
  recoveryEvidence,
  runSafety,
  type RecoveryResultView,
} from './simulationRunState.js';

function run(overrides: {
  runKey?: string;
  revision?: number;
  status?: string;
  faultMayBeActive?: boolean;
  faultLeaseExpiresAtMs?: number | null;
  abortRequested?: boolean;
} = {}): SimulationControlRun {
  const runKey = overrides.runKey ?? 'sim_a';
  return {
    runKey,
    metadataFingerprint: 'fingerprint',
    metadata: {
      network: 'regtest',
      scenarioId: 'mn-stop',
      scenarioVersion: 1,
      seed: 'seed',
      parameters: { count: 1, durationSeconds: 60 },
    },
    state: {
      status: overrides.status ?? 'draft',
      revision: overrides.revision ?? 1,
      live: false,
      createdAtMs: 1_000,
      updatedAtMs: 2_000,
      stateEnteredAtMs: 2_000,
      runExpiresAtMs: 9_000,
      faultLeaseExpiresAtMs: overrides.faultLeaseExpiresAtMs ?? null,
      faultMayBeActive: overrides.faultMayBeActive ?? false,
      abortRequested: overrides.abortRequested ?? false,
      lastTransition: null,
    },
  };
}

const preflight: SimulationPreflight = {
  passed: true,
  checkedAtMs: 5_000,
  checks: [],
  dataQuality: {
    observerCoveragePercent: 100,
    staleTargetCount: 0,
    explorerLagBlocks: 0,
    confidence: 'high',
  },
};

describe('SelectedRunStore', () => {
  it('holds nothing until a run is selected', () => {
    const store = new SelectedRunStore();
    expect(store.current).toBeNull();
    expect(store.accept(run())).toBe('other-run');
  });

  it('takes the first answer for the selected run', () => {
    const store = new SelectedRunStore();
    store.select('sim_a');
    expect(store.accept(run({ revision: 3 }))).toBe('accepted');
    expect(store.current?.run?.state.revision).toBe(3);
  });

  /*
   * The race the panel lost every time. Two responses in flight, the slower one
   * describing an older state: in arrival order it won, so a run that had
   * already aborted could be redrawn as running. The server's own revision is
   * what settles it.
   */
  it('refuses an answer describing a state the run has already left', () => {
    const store = new SelectedRunStore();
    store.select('sim_a');
    store.accept(run({ revision: 5, status: 'aborted' }));

    expect(store.accept(run({ revision: 4, status: 'fault_active' }))).toBe('stale-revision');
    expect(store.current?.run?.state.status).toBe('aborted');
    expect(store.current?.run?.state.revision).toBe(5);
  });

  it('accepts an equal revision, because an idempotent replay answers with one', () => {
    const store = new SelectedRunStore();
    store.select('sim_a');
    store.accept(run({ revision: 5 }));
    expect(store.accept(run({ revision: 5 }))).toBe('accepted');
  });

  it('drops an answer about a different run', () => {
    const store = new SelectedRunStore();
    store.select('sim_b');
    expect(store.accept(run({ runKey: 'sim_a', revision: 9 }))).toBe('other-run');
    expect(store.current?.run).toBeNull();
  });

  it('discards what it held when the selection moves', () => {
    const store = new SelectedRunStore();
    store.select('sim_a');
    store.accept(run({ revision: 7 }));
    store.select('sim_b');
    expect(store.current).toEqual({ runKey: 'sim_b', run: null, preflight: null });
  });

  it('re-selecting the same run does not blank what is on screen', () => {
    const store = new SelectedRunStore();
    store.select('sim_a');
    store.accept(run({ revision: 7 }));
    store.select('sim_a');
    expect(store.current?.run?.state.revision).toBe(7);
  });

  it('ties a preflight to the run it was run for', () => {
    const store = new SelectedRunStore();
    store.select('sim_a');
    expect(store.acceptPreflight('sim_b', preflight)).toBe('other-run');
    expect(store.current?.preflight).toBeNull();
    expect(store.acceptPreflight('sim_a', preflight)).toBe('accepted');
    expect(store.current?.preflight?.passed).toBe(true);
  });
});

describe('recovery evidence', () => {
  /*
   * The control API's run projection selects runKey, metadataFingerprint,
   * metadata and state. The stored recovery result is a separate field on the
   * document and no endpoint returns it -- which is why the panel's
   * "Recovery proof: all targets clear" line was unreachable code rather than
   * a feature. Absent means unknown, and unknown is said out loud.
   */
  it('is unknown when the API reports none', () => {
    expect(recoveryEvidence(undefined)).toEqual({ known: false, reason: 'not-reported' });
    expect(recoveryEvidence(null)).toEqual({ known: false, reason: 'not-reported' });
  });

  it('reads what a server that did report it would send', () => {
    const recovery: RecoveryResultView = {
      required: true,
      allClear: false,
      targets: [{ targetId: 'mn-1' }, { targetId: 'mn-2' }],
    };
    expect(recoveryEvidence(recovery)).toEqual({ known: true, allClear: false, targetCount: 2 });
  });
});

describe('runSafety', () => {
  it('never claims all-clear without evidence, however the run looks', () => {
    const safety = runSafety(run({ status: 'completed', faultMayBeActive: false }));
    expect(safety.allClear).toBe('unknown');
    expect(safety.faultMayBeActive).toBe(false);
  });

  /*
   * A lease is a deadline, not a cleanup. Reading an expired lease as
   * "the fault is gone" is the exact inversion: it is the moment the fault is
   * most likely to still be there with nothing watching it.
   */
  it('does not turn an expired lease into all-clear', () => {
    const safety = runSafety(run({ faultMayBeActive: true, faultLeaseExpiresAtMs: 1 }));
    expect(safety.allClear).toBe('unknown');
    expect(safety.faultMayBeActive).toBe(true);
    expect(safety.leaseExpiresAtMs).toBe(1);
  });

  it('reports a real recovery result when one is given', () => {
    const clear = runSafety(run(), { required: true, allClear: true, targets: [] });
    expect(clear.allClear).toBe('yes');
    const dirty = runSafety(run(), { required: true, allClear: false, targets: [] });
    expect(dirty.allClear).toBe('no');
  });
});
