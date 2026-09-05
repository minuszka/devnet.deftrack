import { describe, expect, it } from 'vitest';
import { lineSegments } from './healthSeries.js';

const p = (healthRatio: number | null) => ({ healthRatio });

describe('lineSegments', () => {
  it('draws one run when every round formed', () => {
    expect(lineSegments([p(1), p(0.9), p(0.8)])).toEqual([[0, 1, 2]]);
  });

  // The rule this exists for: a round that did not form is a gap, never a zero.
  it('breaks the line at a round that did not form', () => {
    expect(lineSegments([p(1), p(null), p(0.8)])).toEqual([[0], [2]]);
  });

  it('collapses a run of failures into a single break', () => {
    expect(lineSegments([p(1), p(null), p(null), p(null), p(0.5)])).toEqual([[0], [4]]);
  });

  it('keeps a lone formed round between two failures', () => {
    expect(lineSegments([p(null), p(0.5), p(null)])).toEqual([[1]]);
  });

  it('starts and ends cleanly on a failure', () => {
    expect(lineSegments([p(null), p(1), p(1), p(null)])).toEqual([[1, 2]]);
  });

  it('answers an empty or all-failed window with no line at all', () => {
    expect(lineSegments([])).toEqual([]);
    expect(lineSegments([p(null), p(null)])).toEqual([]);
  });

  it('treats a zero ratio as data, because a formed round can be worthless', () => {
    expect(lineSegments([p(0), p(0)])).toEqual([[0, 1]]);
  });
});
