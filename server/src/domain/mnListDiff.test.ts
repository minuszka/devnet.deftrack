import { describe, expect, it } from 'vitest';
import { classifyListDiff, penaltiesAfter, type ListDiffResult } from './mnListDiff.js';

const diff = (partial: Partial<ListDiffResult>): ListDiffResult => ({
  baseHeight: 1199,
  blockHeight: 1200,
  addedMNs: [],
  removedMNs: [],
  updatedMNs: [],
  ...partial,
});

describe('classifying a masternode list diff', () => {
  it('attributes every change to the block it happened in', () => {
    const changes = classifyListDiff(diff({ removedMNs: ['aa'] }));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ proTxHash: 'aa', type: 'removed', height: 1200 });
  });

  it('reads a ban from the ban height appearing', () => {
    const changes = classifyListDiff(diff({ updatedMNs: [{ aa: { PoSeBanHeight: 1200 } }] }));
    expect(changes.map((c) => c.type)).toEqual(['banned']);
  });

  it('reads a revival from the ban height going back to -1', () => {
    // -1 is the absence of a ban, not a height; treating it as one would log
    // every revival as a fresh ban.
    const changes = classifyListDiff(diff({ updatedMNs: [{ aa: { PoSeBanHeight: -1 } }] }));
    expect(changes.map((c) => c.type)).toEqual(['revived']);
  });

  it('ignores penalty decay, which happens every single block', () => {
    // A penalised node appears in every diff as its penalty ticks down. Logging
    // that would bury one ban wave under thousands of rows.
    const changes = classifyListDiff(
      diff({ updatedMNs: [{ aa: { PoSePenalty: 63 } }] }),
      new Map([['aa', 64]])
    );
    expect(changes).toEqual([]);
  });

  it('records a penalty increase, which is a missed duty', () => {
    const changes = classifyListDiff(
      diff({ updatedMNs: [{ aa: { PoSePenalty: 66 } }] }),
      new Map([['aa', 0]])
    );
    expect(changes.map((c) => c.type)).toEqual(['penalty_up']);
    expect(changes[0]?.penaltyAfter).toBe(66);
  });

  it('records a first-seen penalty even with no previous value to compare', () => {
    const changes = classifyListDiff(diff({ updatedMNs: [{ aa: { PoSePenalty: 66 } }] }));
    expect(changes.map((c) => c.type)).toEqual(['penalty_up']);
  });

  it('separates a service change from a registrar change', () => {
    const changes = classifyListDiff(
      diff({
        updatedMNs: [
          { aa: { service: '1.2.3.4:19799' } },
          { bb: { pubKeyOperator: '99', votingAddress: 'Pxyz' } },
        ],
      })
    );
    expect(changes.map((c) => [c.proTxHash, c.type])).toEqual([
      ['aa', 'service_changed'],
      ['bb', 'key_changed'],
    ]);
  });

  it('emits one key_changed even when several key fields moved at once', () => {
    const changes = classifyListDiff(
      diff({ updatedMNs: [{ aa: { ownerAddress: 'P1', votingAddress: 'P2', payoutAddress: 'P3' } }] })
    );
    expect(changes).toHaveLength(1);
  });

  it('reports a ban and the penalty that caused it as separate transitions', () => {
    const changes = classifyListDiff(
      diff({ updatedMNs: [{ aa: { PoSeBanHeight: 1200, PoSePenalty: 100 } }] }),
      new Map([['aa', 66]])
    );
    expect(changes.map((c) => c.type).sort()).toEqual(['banned', 'penalty_up']);
  });
});

describe('carrying penalties to the next block', () => {
  it('follows registration, update and removal', () => {
    const before = new Map([['old', 10]]);
    const after = penaltiesAfter(
      diff({
        addedMNs: [{ proTxHash: 'new', state: { PoSePenalty: 0 } }],
        removedMNs: ['old'],
        updatedMNs: [{ kept: { PoSePenalty: 42 } }],
      }),
      before
    );
    expect(after.get('new')).toBe(0);
    expect(after.has('old')).toBe(false);
    expect(after.get('kept')).toBe(42);
  });

  it('leaves a node alone when the diff says nothing about its penalty', () => {
    const after = penaltiesAfter(diff({ updatedMNs: [{ aa: { service: 'x' } }] }), new Map([['aa', 7]]));
    expect(after.get('aa')).toBe(7);
  });
});
