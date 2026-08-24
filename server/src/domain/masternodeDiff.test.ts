import { describe, expect, it } from 'vitest';
import { findRemoved } from './masternodeDiff.js';

describe('masternodes gone from protx list registered', () => {
  const known = [
    { proTxHash: 'a', active: true },
    { proTxHash: 'b', active: true },
    { proTxHash: 'c', active: false },
  ];

  it('returns the rows the node no longer lists', () => {
    expect(findRemoved(known, new Set(['a']))).toEqual([{ proTxHash: 'b', active: true }]);
  });

  it('does not report an already-inactive row again', () => {
    // Otherwise every poll would emit another removal event for the same node.
    expect(findRemoved(known, new Set())).toEqual([
      { proTxHash: 'a', active: true },
      { proTxHash: 'b', active: true },
    ]);
  });

  it('treats a missing active flag as live, so rows written before the field exist', () => {
    expect(findRemoved([{ proTxHash: 'legacy' }], new Set())).toEqual([{ proTxHash: 'legacy' }]);
  });

  it('reports nothing when the list still holds everything known', () => {
    expect(findRemoved(known, new Set(['a', 'b', 'c']))).toEqual([]);
  });
});
