import { describe, expect, it } from 'vitest';
import { compareByCodeUnit } from './codeUnitOrder.js';

describe('compareByCodeUnit', () => {
  it('orders by code unit where collation would disagree', () => {
    const diverging: Array<[string, string]> = [
      ['Height', 'aHeight'],
      ['aB', 'ab'],
      ['a_0b0', 'a-zz'],
    ];
    for (const [a, b] of diverging) {
      expect(Math.sign(compareByCodeUnit(a, b))).toBe(a < b ? -1 : 1);
      // Each pair is here because the two rules really do disagree; if a future
      // ICU build made them agree, this test would stop proving anything.
      expect(Math.sign(a.localeCompare(b))).not.toBe(Math.sign(compareByCodeUnit(a, b)));
    }
  });

  it('is a total order: antisymmetric, and zero only for equals', () => {
    const words = ['a', 'ab', 'a-b', 'a_b', 'A', 'aB', 'mn02', 'mn-1', '', '0'];
    for (const a of words) {
      expect(compareByCodeUnit(a, a)).toBe(0);
      for (const b of words) {
        // Summed rather than negated: -0 and 0 are distinct under Object.is.
        expect(Math.sign(compareByCodeUnit(a, b)) + Math.sign(compareByCodeUnit(b, a))).toBe(0);
        if (a !== b) expect(compareByCodeUnit(a, b)).not.toBe(0);
      }
    }
  });

  it('sorts the same regardless of the collation the host would use', () => {
    // The property that matters: the result is a function of the strings alone.
    const ids = ['a_0b0', 'a-zz', 'mn02', 'mn-1', 'Height', 'aHeight'];
    const sorted = [...ids].sort(compareByCodeUnit);
    expect(sorted).toEqual(['Height', 'a-zz', 'aHeight', 'a_0b0', 'mn-1', 'mn02']);
  });
});
