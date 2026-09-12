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

/**
 * F06: the host table's node count was the count of nodes the sample selected,
 * under a column called "Masternodes".
 *
 * The live reading that found it: a host with seven registered masternodes
 * showed five, because the window had drawn five of them. The other two had not
 * gone anywhere -- they had been passed over, which is the finding this page
 * exists to surface, and the table erased it by reporting a smaller host.
 */
describe('host node counts', () => {
  const sevenNodes = new Map(
    Array.from({ length: 7 }, (_unused, i) => [
      `mn-${i}`,
      { host: 'host-a', operatorLabel: null, registeredHeight: 1 },
    ])
  );

  it('reports the registry size and the selected count as two numbers', () => {
    // Five of the seven drawn, twice each.
    const members = Array.from({ length: 5 }, (_unused, i): [string, boolean] => [`mn-${i}`, true]);
    const f = selectionFairness(
      [round(members, 5), round(members, 5)],
      sevenNodes
    );
    const host = f.hosts.find((h) => h.host === 'host-a')!;
    expect(host.currentRegisteredNodes).toBe(7);
    expect(host.nodes).toBe(5);
    expect(host.timesSelected).toBe(10);
  });

  it('lists a currently-registered host the window never drew from', () => {
    const nodes = new Map([
      ['mn-a', { host: 'host-a', operatorLabel: null, registeredHeight: 1 }],
      ['mn-b', { host: 'host-quiet', operatorLabel: null, registeredHeight: 1 }],
    ]);
    const f = selectionFairness([round([['mn-a', true]], 1)], nodes);
    const quiet = f.hosts.find((h) => h.host === 'host-quiet');
    // Absent from the table would read as absent from the network.
    expect(quiet).toBeDefined();
    expect(quiet?.currentRegisteredNodes).toBe(1);
    expect(quiet?.nodes).toBe(0);
    expect(quiet?.timesSelected).toBe(0);
  });

  /*
   * A corrected expectation, not a deleted one.
   *
   * This case used to assert 1: the node registered after every round in the
   * window was dropped, on the argument that counting it would manufacture a
   * starved host out of a new one. The argument is sound and it is about a
   * different number -- `neverSelected` and `roundsEligible` are where it
   * belongs, and both still apply it. Applied HERE it made "how many are
   * registered now" depend on which window and which profile were being asked
   * about, so a masternode registered yesterday was missing from the count of
   * what exists today. The field's own contract says the registry rather than
   * the sample, and the implementation disagreed with it.
   *
   * The two columns answer different questions, which is why there are two: a
   * host showing 2 registered and 1 selected is being described, not accused.
   */
  it('counts the whole current registry, including a node the window predates', () => {
    const nodes = new Map([
      ['mn-old', { host: 'host-a', operatorLabel: null, registeredHeight: 100 }],
      ['mn-new', { host: 'host-a', operatorLabel: null, registeredHeight: 9_000 }],
    ]);
    const f = selectionFairness(
      [
        { ...round([['mn-old', true]], 1), expectedHeight: 200 },
        { ...round([['mn-old', true]], 1), expectedHeight: 300 },
      ],
      nodes
    );
    const host = f.hosts.find((h) => h.host === 'host-a')!;
    expect(host.currentRegisteredNodes).toBe(2);
    // What this window actually drew is the other column, and it did not move.
    expect(host.nodes).toBe(1);
    // And the new node is still not accused of being passed over: it was not
    // there to pass over.
    expect(f.neverSelected).not.toContain('mn-new');
    expect(f.nodes.find((n) => n.proTxHash === 'mn-old')?.roundsEligible).toBe(2);
  });
});

/**
 * The page summed the rows it had been sent, and the route sends the first 200.
 * On a larger network that headline described a slice and called it the
 * network.
 */
describe('totals', () => {
  it('counts every node, whatever a caller later truncates', () => {
    const members = Array.from({ length: 300 }, (_unused, i): [string, boolean] => [
      `mn-${i}`,
      i % 10 !== 0,
    ]);
    const f = selectionFairness([round(members, 300)], new Map(), 1);
    expect(f.nodes).toHaveLength(300);
    expect(f.totals.nodesCounted).toBe(300);
    expect(f.totals.timesSelected).toBe(300);
    // Every tenth member invalid.
    expect(f.totals.timesInvalid).toBe(30);
    expect(f.totals.worstInvalidRate).toBe(1);
  });

  it('reports no worst rate when nothing met the sample floor', () => {
    const f = selectionFairness([round([['a', false]])], new Map(), 5);
    expect(f.totals.timesInvalid).toBe(1);
    expect(f.totals.worstInvalidRate).toBeNull();
  });
});
