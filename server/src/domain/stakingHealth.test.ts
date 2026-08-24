import { describe, expect, it } from 'vitest';
import { stakingHealth, type BlockSample } from './stakingHealth.js';

const chain = (spec: Array<[number, string | null]>, start = 1000, step = 150): BlockSample[] =>
  spec.map(([offset, payee], i) => ({ height: start + i, time: start * step + offset, payee }));

describe('staking health', () => {
  it('measures intervals in chain order, not sample order', () => {
    const shuffled: BlockSample[] = [
      { height: 3, time: 300, payee: 'a' },
      { height: 1, time: 100, payee: 'a' },
      { height: 2, time: 200, payee: 'a' },
    ];
    const h = stakingHealth(shuffled);
    expect(h.fromHeight).toBe(1);
    expect(h.toHeight).toBe(3);
    expect(h.medianIntervalSec).toBe(100);
  });

  it('ignores a backwards timestamp instead of reporting a negative interval', () => {
    // Block times are written by the staking node and can step backwards; that
    // is a clock artefact, not a measurement of anything.
    const h = stakingHealth([
      { height: 1, time: 100, payee: 'a' },
      { height: 2, time: 90, payee: 'a' },
      { height: 3, time: 250, payee: 'a' },
    ]);
    expect(h.medianIntervalSec).toBe(160);
  });

  it('counts a long pause as a stall', () => {
    const h = stakingHealth([
      { height: 1, time: 0, payee: 'a' },
      { height: 2, time: 150, payee: 'a' },
      { height: 3, time: 1500, payee: 'a' },
    ]);
    expect(h.stallCount).toBe(1);
    expect(h.longestGapSec).toBe(1350);
  });

  it('reports one producer as total concentration', () => {
    const h = stakingHealth(chain([[0, 'solo'], [150, 'solo'], [300, 'solo']]));
    expect(h.distinctStakers).toBe(1);
    expect(h.hhi).toBe(1);
    expect(h.topStakerShare).toBe(1);
  });

  it('gives no Gini for a single producer, rather than a misleading zero', () => {
    // Zero would read as "perfectly equal", which is the opposite of the truth.
    const h = stakingHealth(chain([[0, 'solo'], [150, 'solo']]));
    expect(h.gini).toBeNull();
  });

  it('reports an even split as low concentration', () => {
    const h = stakingHealth(chain([[0, 'a'], [150, 'b'], [300, 'c'], [450, 'd']]));
    expect(h.distinctStakers).toBe(4);
    expect(h.hhi).toBeCloseTo(0.25, 6);
    expect(h.gini).toBeCloseTo(0, 6);
    expect(h.topStakerShare).toBeCloseTo(0.25, 6);
  });

  it('separates a dominant producer from the rest', () => {
    const h = stakingHealth(
      chain([[0, 'big'], [150, 'big'], [300, 'big'], [450, 'big'], [600, 'small']])
    );
    expect(h.topStakerShare).toBeCloseTo(0.8, 6);
    expect(h.hhi).toBeCloseTo(0.68, 6);
    expect(h.gini!).toBeGreaterThan(0);
    expect(h.stakers[0]).toEqual({ payee: 'big', blocks: 4, share: 0.8 });
  });

  it('ignores blocks that paid nobody', () => {
    // A proof-of-work block has no coinstake payee; counting it as a staker
    // would invent a producer.
    const h = stakingHealth(chain([[0, null], [150, 'a'], [300, 'a']]));
    expect(h.distinctStakers).toBe(1);
    expect(h.blocks).toBe(3);
  });

  it('survives an empty window without inventing numbers', () => {
    const h = stakingHealth([]);
    expect(h.blocks).toBe(0);
    expect(h.medianIntervalSec).toBeNull();
    expect(h.hhi).toBeNull();
    expect(h.topStakerShare).toBeNull();
  });
});
