import { describe, expect, it } from 'vitest';
import { quorumReorgReset } from './reorg.js';

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
