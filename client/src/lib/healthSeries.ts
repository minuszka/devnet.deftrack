/**
 * The geometry rule behind the health chart, on its own so it can be tested.
 *
 * A round that did not form has no health ratio, and the line must break at it
 * rather than run through it. Plotted at zero it would assert that the quorum
 * formed with no valid members -- a different and untrue statement -- and drawn
 * straight through, it would lead the eye across a gap that never had data.
 *
 * The rule lives here rather than in the component because a component module
 * calls `customElements.define` at import time, so nothing in it can be
 * exercised outside a browser.
 */
export interface SeriesPoint {
  healthRatio: number | null;
}

/**
 * Runs of consecutive indices that have a ratio. One index per run is kept as
 * a run of its own: a lone formed round between two failures is a point, and
 * dropping it would hide a round that happened.
 */
export function lineSegments(points: readonly SeriesPoint[]): number[][] {
  const segments: number[][] = [];
  let current: number[] = [];

  points.forEach((p, i) => {
    if (typeof p.healthRatio === 'number') {
      current.push(i);
    } else if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  });
  if (current.length > 0) segments.push(current);

  return segments;
}
