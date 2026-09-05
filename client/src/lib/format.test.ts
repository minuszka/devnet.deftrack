import { describe, expect, it } from 'vitest';
import { ago, coin, duration, num, ratio, shortHash, utc } from './format.js';

describe('num', () => {
  it('groups thousands and leaves an absent value absent', () => {
    expect(num(1234567)).toBe('1,234,567');
    expect(num(0)).toBe('0');
    expect(num(null)).toBe('—');
    expect(num(undefined)).toBe('—');
  });
});

describe('ratio', () => {
  // The distinction the whole site rests on: null is "no ratio exists",
  // which is what a round that did not form has. Rendering it as 0% would
  // assert that the quorum formed with no valid members.
  it('never turns a missing ratio into zero', () => {
    expect(ratio(null)).toBe('—');
    expect(ratio(undefined)).toBe('—');
    expect(ratio(0)).toBe('0.0%');
  });

  it('reads a ratio as a percentage to one decimal', () => {
    expect(ratio(1)).toBe('100.0%');
    expect(ratio(0.8333)).toBe('83.3%');
  });
});

describe('shortHash', () => {
  const hash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it('keeps both ends, which is what makes a hash recognisable', () => {
    expect(shortHash(hash)).toBe('01234567…abcdef');
    expect(shortHash(hash, 10, 8)).toBe('0123456789…89abcdef');
  });

  it('leaves a short value alone rather than eliding into nonsense', () => {
    expect(shortHash('abc')).toBe('abc');
    expect(shortHash(null)).toBe('—');
  });
});

/** The grouping separator is a narrow no-break space, not an ordinary one. */
const NB = ' ';

describe('coin', () => {
  // The supply is 1.1e17 satoshis, past Number.MAX_SAFE_INTEGER: parsed as a
  // float, the low digits are quietly lost, and a balance is exactly the place
  // that must not happen.
  it('keeps every digit of a value beyond the safe integer range', () => {
    expect(coin('110000000000000001')).toBe(`1${NB}100${NB}000${NB}000.00`);
    expect(coin('110000000000000001', 8)).toBe(`1${NB}100${NB}000${NB}000.00000001`);
  });

  it('formats an ordinary amount', () => {
    expect(coin('1100000000')).toBe('11.00');
    expect(coin('0')).toBe('0.00');
    expect(coin('50')).toBe('0.00');
    expect(coin('50', 8)).toBe('0.00000050');
  });

  it('carries a negative sign outside the digits', () => {
    expect(coin('-1100000000')).toBe('-11.00');
  });

  it('answers an absent or unparsable value with a dash, not a zero', () => {
    expect(coin(null)).toBe('—');
    expect(coin(undefined)).toBe('—');
    expect(coin('not a number')).toBe('—');
  });
});

describe('ago', () => {
  it('reads recent times in the unit a reader thinks in', () => {
    const now = Date.now();
    expect(ago(new Date(now - 5_000).toISOString())).toBe('5s ago');
    expect(ago(new Date(now - 5 * 60_000).toISOString())).toBe('5m ago');
    expect(ago(new Date(now - 5 * 3_600_000).toISOString())).toBe('5h ago');
    expect(ago(new Date(now - 5 * 86_400_000).toISOString())).toBe('5d ago');
  });

  it('never reports a future timestamp as negative', () => {
    expect(ago(new Date(Date.now() + 60_000).toISOString())).toBe('0s ago');
  });
});

describe('utc', () => {
  // Node logs are UTC and the wall clock here is not; a timestamp without the
  // Z has already cost an hour of confusion on this project.
  it('states the zone it is in', () => {
    expect(utc('2026-09-05T14:36:55.123Z')).toBe('2026-09-05 14:36:55Z');
  });
});

describe('duration', () => {
  it('drops the units too small to matter at each scale', () => {
    expect(duration(90)).toBe('1m');
    expect(duration(3 * 3600 + 25 * 60)).toBe('3h 25m');
    expect(duration(2 * 86400 + 5 * 3600)).toBe('2d 5h');
  });
});
