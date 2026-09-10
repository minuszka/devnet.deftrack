import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS_SEC, summariseArrival, type ArrivalSample } from './blockArrival.js';

/**
 * The numbers in the first case are the real ones: block 11059 on 2026-09-10
 * carries header time 13:36:42Z and the seed connected it at 13:39:34Z, 172 s,
 * while its neighbours were within a handful of seconds. That block is why
 * this module exists.
 */
const T = (iso: string): Date => new Date(iso);
const unix = (iso: string): number => Math.floor(new Date(iso).getTime() / 1000);

const REAL: ArrivalSample[] = [
  { height: 11057, time: unix('2026-09-10T13:32:42Z'), firstSeenAt: T('2026-09-10T13:32:47Z') },
  { height: 11058, time: unix('2026-09-10T13:33:46Z'), firstSeenAt: T('2026-09-10T13:33:47Z') },
  { height: 11059, time: unix('2026-09-10T13:36:42Z'), firstSeenAt: T('2026-09-10T13:39:34Z') },
  { height: 11060, time: unix('2026-09-10T13:43:30Z'), firstSeenAt: T('2026-09-10T13:43:35Z') },
];

describe('summariseArrival', () => {
  it('measures the lag from the block timestamp to the live sighting', () => {
    const s = summariseArrival(REAL);
    expect(s.blocksConsidered).toBe(4);
    expect(s.measured).toBe(4);
    expect(s.points.map((p) => p.lagSec)).toEqual([5, 1, 172, 5]);
    expect(s.lagSec.max).toBe(172);
    expect(s.lagSec.min).toBe(1);
  });

  it('counts a late block against the measured blocks, and names it', () => {
    const s = summariseArrival(REAL);
    expect(s.late).toEqual([
      { thresholdSec: 30, blocks: 1, share: 0.25 },
      { thresholdSec: 120, blocks: 1, share: 0.25 },
    ]);
    expect(s.slowest[0]).toMatchObject({ height: 11059, lagSec: 172 });
  });

  it('never turns an unobserved block into a fast one', () => {
    // The failure this guards: blocks indexed before the watcher started have
    // no first sight, and treating them as zero would drag the median to a
    // value nobody would question.
    const withGaps: ArrivalSample[] = [
      ...REAL,
      { height: 11061, time: unix('2026-09-10T13:44:02Z'), firstSeenAt: null },
      { height: 11062, time: unix('2026-09-10T13:46:08Z'), firstSeenAt: null },
    ];
    const s = summariseArrival(withGaps);
    expect(s.blocksConsidered).toBe(6);
    expect(s.measured).toBe(4);
    expect(s.unmeasured).toBe(2);
    // Shares are over the four that were measured, not the six in the window.
    expect(s.late[1]!.share).toBe(0.25);
    expect(s.points.map((p) => p.lagSec)).toEqual([5, 1, 172, 5, null, null]);
    expect(s.slowest.map((p) => p.height)).toEqual([11059, 11057, 11060, 11058]);
    expect(s.firstMeasuredHeight).toBe(11057);
    expect(s.lastMeasuredHeight).toBe(11060);
  });

  it('keeps a negative lag instead of clamping it, because it is a clock statement', () => {
    const skewed: ArrivalSample[] = [
      { height: 10, time: unix('2026-09-10T10:00:30Z'), firstSeenAt: T('2026-09-10T10:00:20Z') },
      { height: 11, time: unix('2026-09-10T10:02:00Z'), firstSeenAt: T('2026-09-10T10:02:03Z') },
    ];
    const s = summariseArrival(skewed);
    expect(s.lagSec.min).toBe(-10);
    expect(s.points[0]!.lagSec).toBe(-10);
    expect(s.late[0]!.blocks).toBe(0);
  });

  it('reports nulls, not zeros, when nothing was measured', () => {
    const s = summariseArrival([
      { height: 5, time: unix('2026-09-10T09:00:00Z'), firstSeenAt: null },
    ]);
    expect(s.measured).toBe(0);
    expect(s.lagSec).toEqual({ min: null, p50: null, p90: null, p99: null, max: null });
    expect(s.late.every((l) => l.share === null && l.blocks === 0)).toBe(true);
    expect(s.slowest).toEqual([]);
    expect(summariseArrival([]).blocksConsidered).toBe(0);
  });

  it('orders points oldest first whatever order the query returned', () => {
    const s = summariseArrival([...REAL].reverse());
    expect(s.points.map((p) => p.height)).toEqual([11057, 11058, 11059, 11060]);
  });

  it('uses the same percentile convention as the ChainLock report', () => {
    // Ten measured values 0..9 -> p50 is the sixth, p90 the tenth: index
    // floor(n * p), which is what /chainlocks already does.
    const samples: ArrivalSample[] = Array.from({ length: 10 }, (_, i) => ({
      height: 100 + i,
      time: 1_000_000,
      firstSeenAt: new Date(1_000_000_000 + i * 1000),
    }));
    const s = summariseArrival(samples);
    expect(s.measured).toBe(10);
    expect(s.lagSec.p50).toBe(s.points[5]!.lagSec);
    expect(s.lagSec.p90).toBe(s.points[9]!.lagSec);
    expect(s.lagSec.p99).toBe(s.points[9]!.lagSec);
  });

  it('accepts the thresholds it is given, and defaults to 30 s and 120 s', () => {
    expect(DEFAULT_THRESHOLDS_SEC).toEqual([30, 120]);
    const s = summariseArrival(REAL, [1, 300]);
    expect(s.late.map((l) => [l.thresholdSec, l.blocks])).toEqual([
      [1, 3],
      [300, 0],
    ]);
  });

  it('treats an unparseable timestamp as unmeasured rather than as an epoch arrival', () => {
    const s = summariseArrival([
      { height: 7, time: unix('2026-09-10T10:00:00Z'), firstSeenAt: 'not a date' },
    ]);
    expect(s.measured).toBe(0);
    expect(s.unmeasured).toBe(1);
  });
});
