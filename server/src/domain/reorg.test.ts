import { describe, expect, it } from 'vitest';
import {
  MAX_ROLLBACK_DEPTH,
  quorumReorgReset,
  reorgVerdict,
  rewindStep,
} from './reorg.js';

const STORED = 'aaaa';
const OTHER = 'bbbb';

describe('deciding whether the stored chain was reorged away', () => {
  it('continues when the node reports the hash we stored', () => {
    expect(
      reorgVerdict({ indexedHeight: 8028, indexedHash: STORED, nodeTip: 8030, nodeHash: STORED })
    ).toEqual({ action: 'continue' });
  });

  it('rewinds only when the node gave a hash and it differs', () => {
    expect(
      reorgVerdict({ indexedHeight: 8028, indexedHash: STORED, nodeTip: 8030, nodeHash: OTHER })
    ).toEqual({ action: 'rewind' });
  });

  it('waits instead of rewinding when the node did not answer', () => {
    // The negative control for the whole file. Before this existed, a failed
    // getblockhash was folded into "the hash differs", so an RPC timeout, a
    // restart or a -28 warmup entered the rollback path and deleted the index.
    const verdict = reorgVerdict({
      indexedHeight: 8028,
      indexedHash: STORED,
      nodeTip: 8030,
      nodeHash: null,
    });
    expect(verdict.action).toBe('wait');
  });

  it('waits when the node is behind us, without consulting its hash at all', () => {
    // A reindexing node answers "Block height out of range" for every height it
    // has not rebuilt. That is a node catching up, not a chain that abandoned
    // our history -- and it is the case that would have deleted 8028 blocks.
    const verdict = reorgVerdict({
      indexedHeight: 8028,
      indexedHash: STORED,
      nodeTip: 4000,
      nodeHash: OTHER,
    });
    expect(verdict.action).toBe('wait');
    expect(verdict).toMatchObject({ reason: expect.stringContaining('4000') });
  });

  it('treats a node exactly at our height as able to answer', () => {
    expect(
      reorgVerdict({ indexedHeight: 8028, indexedHash: STORED, nodeTip: 8028, nodeHash: STORED })
    ).toEqual({ action: 'continue' });
  });
});

describe('walking back to the fork point', () => {
  const floor = 8028 - MAX_ROLLBACK_DEPTH;

  it('settles where stored and node agree', () => {
    expect(
      rewindStep({ cursor: 8026, floor, storedHash: STORED, nodeHash: STORED })
    ).toEqual({ action: 'settle' });
  });

  it('steps down where they disagree', () => {
    expect(
      rewindStep({ cursor: 8026, floor, storedHash: STORED, nodeHash: OTHER })
    ).toEqual({ action: 'step' });
  });

  it('steps past a height the index never stored', () => {
    // A hole in the index is not evidence of a fork; the block loop fills it.
    expect(
      rewindStep({ cursor: 8026, floor, storedHash: null, nodeHash: OTHER })
    ).toEqual({ action: 'step' });
  });

  it('stops the walk when the node stops answering mid-rewind', () => {
    // Without this the cursor runs to -1 and the rollback deletes everything,
    // which is the same catastrophe by a slower route.
    const step = rewindStep({ cursor: 8026, floor, storedHash: STORED, nodeHash: null });
    expect(step.action).toBe('wait');
  });

  it('refuses to rewind deeper than the cap without an operator', () => {
    const step = rewindStep({ cursor: floor, floor, storedHash: STORED, nodeHash: OTHER });
    expect(step.action).toBe('wait');
    expect(step).toMatchObject({ reason: expect.stringContaining(String(MAX_ROLLBACK_DEPTH)) });
  });

  it('still allows a rewind that lands exactly on the cap', () => {
    expect(
      rewindStep({ cursor: floor + 1, floor, storedHash: STORED, nodeHash: OTHER })
    ).toEqual({ action: 'step' });
  });
});

describe('quorum data after a reorg', () => {
  it('selects rounds scheduled above the fork point and rounds mined above it', () => {
    const { filter } = quorumReorgReset(1200);
    expect(filter).toEqual({
      $or: [{ expectedHeight: { $gt: 1200 } }, { minedHeight: { $gt: 1200 } }],
    });
  });

  it('returns a round to pending instead of deleting it', () => {
    // The schedule is a pure function of height, so the slot survives the reorg
    // and keeps its roundKey; only the observation is discarded.
    const { update } = quorumReorgReset(1200);
    const set = (update as { $set: Record<string, unknown> }).$set;
    expect(set.status).toBe('pending');
    expect(set.formed).toBe(false);
  });

  it('clears every field that was read off the abandoned chain', () => {
    const set = (quorumReorgReset(0).update as { $set: Record<string, unknown> }).$set;
    for (const key of [
      'quorumHash',
      'minedBlockHash',
      'minedHeight',
      'effectiveSize',
      'numValidMembers',
      'healthRatio',
      'resolvedAt',
    ]) {
      expect(set[key]).toBeNull();
    }
    expect(set.members).toEqual([]);
    expect(set.invalidMembers).toEqual([]);
    // Nobody is punished by a round that has not formed.
    expect(set.punishedCount).toBe(0);
  });

  it('leaves the profile snapshot alone', () => {
    // size/minSize/threshold describe the rules the round ran under; a reorg
    // does not change them, and rewriting them would destroy the snapshot.
    const set = (quorumReorgReset(10).update as { $set: Record<string, unknown> }).$set;
    for (const key of ['size', 'minSize', 'threshold', 'dkgInterval', 'roundKey', 'firstSeenAt']) {
      expect(set).not.toHaveProperty(key);
    }
  });
});
