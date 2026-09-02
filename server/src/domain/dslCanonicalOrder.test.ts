import { describe, expect, it } from 'vitest';
import { canonicalDslOrder, resolveMissedMembers } from './dslCanonicalOrder.js';

/** A proTxHash-shaped value: 32 bytes of lowercase hex. */
const hash = (...leadingBytes: number[]) => {
  const head = leadingBytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return (head + '00'.repeat(32)).slice(0, 64);
};

describe('DSL canonical order', () => {
  it('sorts by uint256 bytes, which is the printed hex reversed', () => {
    // These two differ only in the first and last byte, so the two orderings
    // disagree: by printed hex `01..ff` comes first, by internal bytes the one
    // ending in the smaller byte does.
    const a = '01' + '00'.repeat(30) + 'ff';
    const b = 'ff' + '00'.repeat(30) + '01';

    expect(canonicalDslOrder([b, a])).toEqual([b, a]);
    // ...and the trap: sorting the printed strings gives the other answer.
    expect([b, a].slice().sort()).toEqual([a, b]);
  });

  it('is a total order that does not depend on input order', () => {
    const hashes = [hash(0x0a), hash(0xff), hash(0x01, 0x02), hash(0x00, 0xff), hash(0x7f)];
    const once = canonicalDslOrder(hashes);
    const again = canonicalDslOrder([...hashes].reverse());
    expect(again).toEqual(once);
    expect(once).toHaveLength(hashes.length);
    expect(new Set(once)).toEqual(new Set(hashes));
  });

  it('accepts an upper-case hash without moving it', () => {
    const lower = hash(0x0a, 0xbc);
    const order = canonicalDslOrder([lower.toUpperCase(), hash(0x0a, 0xbb)]);
    // The comparison lower-cases; the value returned is what was given.
    expect(order[1]).toBe(lower.toUpperCase());
  });
});

describe('resolving a commitment\'s missed indices', () => {
  const order = [hash(1), hash(2), hash(3), hash(4), hash(5)];

  it('names the members the indices point at', () => {
    expect(resolveMissedMembers(order, [0, 3], 5)).toEqual([hash(1), hash(4)]);
    expect(resolveMissedMembers(order, [], 5)).toEqual([]);
  });

  it('refuses rather than guessing when the list is not the one counted', () => {
    // A list of a different length is not the list the commitment counted: the
    // chain re-orged, or the height is wrong. Naming members from it would
    // accuse masternodes that did nothing.
    expect(resolveMissedMembers(order, [0], 6)).toBeNull();
    expect(resolveMissedMembers(order.slice(0, 4), [0], 5)).toBeNull();
  });

  it('refuses an index outside the list', () => {
    expect(resolveMissedMembers(order, [5], 5)).toBeNull();
    expect(resolveMissedMembers(order, [-1], 5)).toBeNull();
    expect(resolveMissedMembers(order, [1.5], 5)).toBeNull();
  });

  it('resolves the devnet epoch that made the ordering worth pinning', () => {
    // Epoch 264 flagged five indices. Against the true order they are the five
    // masternodes PoSe had already banned, all on one host; against the printed
    // hex they were five healthy ones on five hosts. The shape is reproduced
    // here rather than the real hashes, which are not this repository's to hold.
    const registered = [
      '05' + '00'.repeat(30) + 'aa',
      '04' + '00'.repeat(30) + 'bb',
      '03' + '00'.repeat(30) + 'cc',
      '02' + '00'.repeat(30) + 'dd',
      '01' + '00'.repeat(30) + 'ee',
    ];
    const canonical = canonicalDslOrder(registered);
    // Printed-hex order would be the exact reverse of this.
    expect(canonical[0]).toBe(registered[0]);
    expect(resolveMissedMembers(canonical, [0], registered.length)).toEqual([registered[0]]);
  });
});
