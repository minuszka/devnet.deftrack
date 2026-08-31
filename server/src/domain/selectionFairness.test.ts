import { describe, expect, it } from 'vitest';
import { selectionFairness, type RoundMembership } from './selectionFairness.js';

const round = (members: Array<[string, boolean]>, effectiveSize: number | null = null): RoundMembership => ({
  members: members.map(([proTxHash, valid]) => ({ proTxHash, valid, operatorLabel: null })),
  effectiveSize: effectiveSize ?? members.length,
});

const known = (rows: Array<[string, string | null]>) =>
  new Map(rows.map(([h, host]) => [h, { host, operatorLabel: null }]));

describe('selection fairness', () => {
  it('counts how often each node was chosen and how often it then failed', () => {
    const f = selectionFairness([
      round([['a', true], ['b', false]]),
      round([['a', true], ['b', true]]),
    ]);
    const a = f.nodes.find((n) => n.proTxHash === 'a')!;
    const b = f.nodes.find((n) => n.proTxHash === 'b')!;
    expect(a.timesSelected).toBe(2);
    expect(b.timesInvalid).toBe(1);
    expect(b.selectionRate).toBe(1);
  });

  it('refuses a failure rate below the sample floor', () => {
    // One failure out of two selections is two data points, not 50%. Printing
    // it beside a node with two hundred selections invites the wrong comparison.
    const f = selectionFairness([round([['a', false]]), round([['a', true]])], new Map(), 5);
    expect(f.nodes[0]?.invalidRate).toBeNull();
    expect(f.nodes[0]?.timesInvalid).toBe(1);
  });

  it('reports a failure rate once there are enough selections', () => {
    const rounds = Array.from({ length: 10 }, (_, i) => round([['a', i >= 2]]));
    const f = selectionFairness(rounds, new Map(), 5);
    expect(f.nodes[0]?.invalidRate).toBeCloseTo(0.2, 6);
  });

  it('states the rate chance alone would produce', () => {
    // "Selected in 40% of rounds" means nothing without this: with a quorum of
    // 2 drawn from 5 masternodes, 40% *is* the expectation.
    const f = selectionFairness(
      [round([['a', true], ['b', true]], 2)],
      known([['a', null], ['b', null], ['c', null], ['d', null], ['e', null]])
    );
    expect(f.expectedSelectionRate).toBeCloseTo(0.4, 6);
  });

  it('names masternodes the selection never reached', () => {
    // A node that is never chosen is invisible in any table built from members,
    // and being passed over is itself the finding.
    const f = selectionFairness([round([['a', true]])], known([['a', null], ['ghost', null]]));
    expect(f.neverSelected).toEqual(['ghost']);
  });

  it('groups by host, because ten masternodes on one machine are not ten participants', () => {
    const f = selectionFairness(
      [
        round([['a', false], ['b', false], ['c', true]]),
        round([['a', false], ['b', true], ['c', true]]),
      ],
      known([['a', 'fn-1'], ['b', 'fn-1'], ['c', 'fn-4']]),
      1
    );
    const fn1 = f.hosts.find((h) => h.host === 'fn-1')!;
    expect(fn1.nodes).toBe(2);
    expect(fn1.timesSelected).toBe(4);
    expect(fn1.timesInvalid).toBe(3);
    expect(fn1.invalidRate).toBeCloseTo(0.75, 6);
  });

  it('says nothing rather than zero when no round was observed', () => {
    const f = selectionFairness([]);
    expect(f.roundsConsidered).toBe(0);
    expect(f.expectedSelectionRate).toBeNull();
    expect(f.nodes).toEqual([]);
  });

  const roundAt = (
    expectedHeight: number,
    members: Array<[string, boolean]>,
    effectiveSize: number | null = null
  ): RoundMembership => ({ ...round(members, effectiveSize), expectedHeight });

  const knownAt = (rows: Array<[string, number | null]>) =>
    new Map(rows.map(([h, registeredHeight]) => [h, { host: null, operatorLabel: null, registeredHeight }]));

  it('holds a node only to the rounds it was registered for', () => {
    // A fleet scale-up must not manufacture starvation: a node registered at
    // height 100 simply did not exist for the round scheduled at 50.
    const rounds = [roundAt(50, [['a', true]]), roundAt(150, [['a', true], ['b', true]])];
    const f = selectionFairness(rounds, knownAt([['a', 0], ['b', 100]]));
    const b = f.nodes.find((n) => n.proTxHash === 'b')!;
    expect(b.roundsEligible).toBe(1);
    expect(b.selectionRate).toBe(1);
    const a = f.nodes.find((n) => n.proTxHash === 'a')!;
    expect(a.roundsEligible).toBe(2);
  });

  it('does not report a node registered after the window as passed over', () => {
    const f = selectionFairness([roundAt(50, [['a', true]])], knownAt([['a', 0], ['late', 100]]));
    expect(f.neverSelected).toEqual([]);
  });

  it('holds each round against the pool registered by its height', () => {
    // Two drawn from a pool of 2, then two drawn from a pool of 4: the
    // expectation is the mean of 1.0 and 0.5 -- today's list would dilute
    // every round measured before the scale-up.
    const f = selectionFairness(
      [roundAt(50, [['a', true], ['b', true]], 2), roundAt(150, [['a', true], ['c', true]], 2)],
      knownAt([['a', 0], ['b', 0], ['c', 100], ['d', 100]])
    );
    expect(f.expectedSelectionRate).toBeCloseTo(0.75, 6);
  });

  it('brackets the selection rate with a 95% interval', () => {
    // 30 picks out of 50 rounds is evidence only relative to this interval;
    // the point estimate alone cannot separate an anomaly from a small sample.
    const rounds = Array.from({ length: 50 }, (_, i) => round([[i < 30 ? 'a' : 'z', true]]));
    const f = selectionFairness(rounds, new Map(), 5);
    const a = f.nodes.find((n) => n.proTxHash === 'a')!;
    expect(a.selectionRate).toBeCloseTo(0.6, 6);
    const [lo, hi] = a.selectionCi95!;
    expect(lo).toBeGreaterThan(0.4);
    expect(lo).toBeLessThan(0.6);
    expect(hi).toBeGreaterThan(0.6);
    expect(hi).toBeLessThan(0.8);
  });
});
