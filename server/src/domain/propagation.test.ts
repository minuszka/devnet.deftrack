import { describe, expect, it } from 'vitest';
import { laggards, propagationSpread, type HostSighting } from './propagation.js';

const sighting = (host: string, ms: number, offset = 1, res = 0): HostSighting => ({
  host,
  receivedAtMs: ms,
  clockOffsetMs: offset,
  resolutionMs: res,
});

describe('propagation spread across hosts', () => {
  it('orders hosts by arrival and measures each one against the earliest', () => {
    const s = propagationSpread([
      sighting('fn-5', 1_000_120),
      sighting('fn-1', 1_000_000),
      sighting('fn-9', 1_000_040),
    ]);
    expect(s.firstHost).toBe('fn-1');
    expect(s.lastHost).toBe('fn-5');
    expect(s.spreadMs).toBe(120);
    expect(s.delays).toEqual([
      { host: 'fn-1', delayMs: 0 },
      { host: 'fn-9', delayMs: 40 },
      { host: 'fn-5', delayMs: 120 },
    ]);
  });

  it('carries an error bar built from the blurriest participant', () => {
    // A 20 ms clock offset and a 50 ms poll interval cannot resolve a 30 ms
    // spread, and pretending otherwise would invent a finding.
    const s = propagationSpread([
      sighting('fn-1', 1_000_000, 20, 50),
      sighting('fn-4', 1_000_030, 2, 0),
    ]);
    expect(s.uncertaintyMs).toBe(70);
    expect(s.withinNoise).toBe(true);
  });

  it('calls a spread real once it clears the error bar', () => {
    const s = propagationSpread([
      sighting('fn-1', 1_000_000, 5, 0),
      sighting('fn-4', 1_002_000, 5, 0),
    ]);
    expect(s.spreadMs).toBe(2000);
    expect(s.withinNoise).toBe(false);
  });

  it('does not correct for clock offset, only declares it', () => {
    // Subtracting the offset would claim a precision NTP does not guarantee.
    const s = propagationSpread([sighting('fn-1', 1_000_000, 18), sighting('fn-4', 1_000_100, 3)]);
    expect(s.delays[1]?.delayMs).toBe(100);
    expect(s.uncertaintyMs).toBe(18);
  });

  it('names the hosts that never reported the hash at all', () => {
    // Silence is the strongest signal there is, and it is invisible unless the
    // expected set is stated.
    const s = propagationSpread([sighting('fn-1', 1)], ['fn-1', 'fn-4', 'fn-5']);
    expect(s.missingHosts).toEqual(['fn-4', 'fn-5']);
  });

  it('reports nothing rather than zero when no host saw it', () => {
    const s = propagationSpread([], ['fn-1']);
    expect(s.hosts).toBe(0);
    expect(s.spreadMs).toBeNull();
    expect(s.missingHosts).toEqual(['fn-1']);
  });
});

describe('finding a consistently late host', () => {
  const spread = (rows: Array<[string, number]>) =>
    propagationSpread(rows.map(([h, ms]) => sighting(h, 1_000_000 + ms)));

  it('separates one late block from a host that is always last', () => {
    const spreads = [
      spread([['fn-1', 0], ['fn-4', 5], ['fn-8', 400]]),
      spread([['fn-1', 0], ['fn-4', 3], ['fn-8', 380]]),
      spread([['fn-1', 2], ['fn-4', 0], ['fn-8', 420]]),
      spread([['fn-1', 0], ['fn-4', 900], ['fn-8', 390]]),
      spread([['fn-1', 1], ['fn-4', 4], ['fn-8', 410]]),
    ];
    const out = laggards(spreads, 5);
    expect(out[0]?.host).toBe('fn-8');
    // Last on four of five, despite fn-4 having the single worst sample.
    expect(out[0]?.lastPlaceShare).toBeCloseTo(0.8, 6);
  });

  it('ignores hosts with too few samples to say anything about', () => {
    const out = laggards([spread([['fn-1', 0], ['fn-4', 10]])], 5);
    expect(out).toEqual([]);
  });
});

describe('a host that cannot read its own clock', () => {
  it('names it and marks the error bar as a floor, not a bound', () => {
    // Treating an unknown offset as zero would quietly assume the very thing
    // the error bar exists to question.
    const s = propagationSpread([
      { host: 'fn-1', receivedAtMs: 1_000_000, clockOffsetMs: null, resolutionMs: 100 },
      { host: 'fn-4', receivedAtMs: 1_000_050, clockOffsetMs: 3, resolutionMs: 100 },
    ]);
    expect(s.clockUnknownHosts).toEqual(['fn-1']);
    expect(s.uncertaintyIsLowerBound).toBe(true);
    // Still computed from what is known, so the figure stays usable.
    expect(s.uncertaintyMs).toBe(103);
  });

  it('says the bound is firm when every host reported its offset', () => {
    const s = propagationSpread([
      { host: 'fn-1', receivedAtMs: 1_000_000, clockOffsetMs: 2, resolutionMs: 0 },
      { host: 'fn-4', receivedAtMs: 1_000_050, clockOffsetMs: 3, resolutionMs: 0 },
    ]);
    expect(s.uncertaintyIsLowerBound).toBe(false);
    expect(s.clockUnknownHosts).toEqual([]);
  });
});
