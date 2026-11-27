import { beforeAll, describe, expect, it, vi } from 'vitest';

type Coverage = typeof import('./experimentCoverage.js');
type Llmq = typeof import('../config/llmq.js');
type Schedule = typeof import('./dkgSchedule.js');

let coverage: Coverage;
let llmq: Llmq;
let schedule: Schedule;

// The production default, pinned so a developer's environment cannot change what is tested.
beforeAll(async () => {
  vi.stubEnv('TRACKED_LLMQ_NAMES', 'llmq_50_60,llmq_60_75,llmq_400_60,llmq_400_85,llmq_defcon');
  coverage = await import('./experimentCoverage.js');
  llmq = await import('../config/llmq.js');
  schedule = await import('./dkgSchedule.js');
  return () => vi.unstubAllEnvs();
});

const dsl = { activationHeight: 5472, epochInterval: 24 };
type Round = { roundKey: string; status: string; detailsComplete?: boolean };
type Epoch = { boundaryHeight: number; status: string; missedCount: number | null };

/** Every scheduled observation in the window, complete, so each test removes exactly one thing. */
function completeWindow(from: number, to: number): { rounds: Round[]; epochs: Epoch[] } {
  const rounds: Round[] = [];
  for (const p of llmq.trackedProfiles()) {
    for (let h = Math.ceil(from / p.dkgInterval) * p.dkgInterval; h <= to; h += p.dkgInterval) {
      if (!schedule.isSchedulable(h, p.formationGateHeight, p.formationEndHeight)) continue;
      rounds.push({ roundKey: schedule.roundKeyFor(p.llmqType, h, 0), status: 'formed', detailsComplete: true });
    }
  }
  const epochs: Epoch[] = [];
  for (let h = Math.ceil(from / 24) * 24; h <= to; h += 24) epochs.push({ boundaryHeight: h, status: 'committed', missedCount: 0 });
  return { rounds, epochs };
}

function check(from: number, to: number, w: { rounds: Round[]; epochs: Epoch[] }, nodeTip: number, acceptUnobserved = false) {
  return coverage.assertScheduledObservations(from, to, dsl, w.epochs, w.rounds, { nodeTip, acceptUnobserved });
}

function verdict(fn: () => unknown): string {
  try {
    fn();
    return 'closes';
  } catch (error) {
    if (error instanceof coverage.UnobservableExperimentWindow) return 'unobservable: ' + error.message;
    if (error instanceof coverage.IncompleteExperimentWindow) return 'incomplete: ' + error.message;
    throw error;
  }
}

const set = (w: { rounds: Round[] }, key: string, patch: Partial<Round>) => {
  const round = w.rounds.find((r) => r.roundKey === key);
  if (!round) throw new Error(`fixture has no round ${key}`);
  Object.assign(round, patch);
};
const drop = (w: { rounds: Round[] }, key: string) => {
  w.rounds = w.rounds.filter((r) => r.roundKey !== key);
};

describe('closing a window whose evidence will never arrive', () => {
  // llmq_defcon, interval 24, four active quorums: at tip 55658 the collector
  // plans nothing below 55656 - 96 = 55560.
  const from = 55400;
  const to = 55650;

  it('closes a complete window and says so with an empty list', () => {
    expect(check(from, to, completeWindow(from, to), 55658)).toEqual([]);
  });

  it('waits for a round the collector can still write, whatever the operator accepts', () => {
    const w = completeWindow(from, to);
    drop(w, '7:55584:0');
    expect(verdict(() => check(from, to, w, 55658, true))).toBe('incomplete: Missing quorum round 7:55584:0');
  });

  it('names a round that left the collector reach and publishes it only on the operator word', () => {
    const w = completeWindow(from, to);
    drop(w, '7:55536:0');
    expect(verdict(() => check(from, to, w, 55658))).toBe(
      'unobservable: 1 scheduled observation(s) in the window can no longer be collected: Missing quorum round 7:55536:0'
    );
    expect(check(from, to, w, 55658, true)).toEqual([
      { kind: 'quorum-round', height: 55536, roundKey: '7:55536:0', reason: 'missing' },
    ]);
  });

  it('treats an undecided round the same way on each side of the floor', () => {
    const near = completeWindow(from, to);
    set(near, '7:55584:0', { status: 'pending', detailsComplete: false });
    expect(verdict(() => check(from, to, near, 55658, true))).toBe('incomplete: Awaiting the result of quorum round 7:55584:0');

    const far = completeWindow(from, to);
    set(far, '7:55512:0', { status: 'pending', detailsComplete: false });
    expect(check(from, to, far, 55658, true)).toEqual([
      { kind: 'quorum-round', height: 55512, roundKey: '7:55512:0', reason: 'undecided' },
    ]);
  });

  it('treats missing member details the same way on each side of the floor', () => {
    const near = completeWindow(from, to);
    set(near, '7:55560:0', { detailsComplete: false });
    expect(verdict(() => check(from, to, near, 55658, true))).toBe(
      'incomplete: Awaiting member details for quorum round 7:55560:0'
    );

    const far = completeWindow(from, to);
    set(far, '7:55536:0', { detailsComplete: false });
    expect(check(from, to, far, 55658, true)).toEqual([
      { kind: 'quorum-round', height: 55536, roundKey: '7:55536:0', reason: 'member-details' },
    ]);
  });

  it('reports a Sentinel gap as permanent, since its row is written with its block', () => {
    const w = completeWindow(from, to);
    w.epochs = w.epochs.filter((e) => e.boundaryHeight !== 55632);
    w.epochs.find((e) => e.boundaryHeight === 55440)!.missedCount = null;
    expect(check(from, to, w, 55658, true)).toEqual([
      { kind: 'sentinel-epoch', height: 55440, reason: 'missed-count' },
      { kind: 'sentinel-epoch', height: 55632, reason: 'missing' },
    ]);
    expect(verdict(() => check(from, to, w, 55658))).toContain('Missing Sentinel epoch at height 55632');
  });

  it('waits for evidence still on its way before asking to accept the permanent gaps', () => {
    const w = completeWindow(from, to);
    drop(w, '7:55536:0');
    drop(w, '7:55608:0');
    expect(verdict(() => check(from, to, w, 55658, true))).toBe('incomplete: Missing quorum round 7:55608:0');
  });
});

describe('the rows the collector could no longer decide on 2026-11-27', () => {
  it('reports the stuck llmq_400_60 round at 14400 instead of keeping its run open for ever', () => {
    // The VPS held this row as pending, out of reach, when #196 was reviewed.
    const from = 13944;
    const to = 16344;
    const w = completeWindow(from, to);
    expect(check(from, to, w, 55658)).toEqual([]);
    set(w, '2:14400:0', { status: 'pending', detailsComplete: false });
    expect(verdict(() => check(from, to, w, 55658))).toBe(
      'unobservable: 1 scheduled observation(s) in the window can no longer be collected: Quorum round 2:14400:0 was never decided'
    );
  });

  it('keeps waiting on a retired profile round its frozen read can still decide', () => {
    // llmq_400_60 retires at 53568; its last round, 53496, is read at 53566, so
    // it stays decidable long after the tip-based floor (55368) has passed it.
    const from = 53400;
    const to = 53600;
    const w = completeWindow(from, to);
    set(w, '2:53496:0', { status: 'pending', detailsComplete: false });
    expect(verdict(() => check(from, to, w, 55658, true))).toBe('incomplete: Awaiting the result of quorum round 2:53496:0');
    // The collector plans no new row there, so a missing one is gone for good.
    drop(w, '2:53496:0');
    expect(check(from, to, w, 55658, true)).toEqual([
      { kind: 'quorum-round', height: 53496, roundKey: '2:53496:0', reason: 'missing' },
    ]);
  });
});
