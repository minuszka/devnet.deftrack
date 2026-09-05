import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  compareArith256,
  compareQuorumScores,
  quorumSelectionModifier,
  selectQuorumMembers,
  type QuorumSelectionMasternode,
} from './quorumMemberSelection.js';

interface Fixture {
  masternodes: QuorumSelectionMasternode[];
  vectors: Array<{
    llmqType: number;
    llmqName: string;
    size: number;
    cycleBaseHeight: number;
    cycleBaseBlockHash: string;
    expectedMemberIndexes: number[];
  }>;
  negativeControl: { height: number; blockHash: string };
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/quorum-member-selection.devnet.json', import.meta.url), 'utf8')
) as Fixture;

function select(vector: Fixture['vectors'][number], masternodes = fixture.masternodes, baseHash = vector.cycleBaseBlockHash) {
  return selectQuorumMembers({
    llmqType: vector.llmqType,
    size: vector.size,
    useRotation: false,
    v20Active: false,
    cycleBaseBlockHash: baseHash,
    masternodes,
  });
}

describe('quorum member selection against formed devnet quorums', () => {
  // Four profiles, four sizes, two of them sharing a base block: the type byte
  // in the modifier is what separates llmq_50_60 from llmq_defcon at 8304.
  for (const vector of fixture.vectors) {
    it(`reproduces ${vector.llmqName} at ${vector.cycleBaseHeight}, member order included`, () => {
      const expected = vector.expectedMemberIndexes.map((index) => fixture.masternodes[index]!.proTxHash);
      expect(select(vector)).toEqual(expected);
    });
  }

  it('is a negative control, not a tautology: a different base block selects a different quorum', () => {
    const vector = fixture.vectors[0]!;
    const expected = vector.expectedMemberIndexes.map((index) => fixture.masternodes[index]!.proTxHash);
    const wrong = select(vector, fixture.masternodes, fixture.negativeControl.blockHash);
    expect(wrong).not.toEqual(expected);
    // and so does the wrong type byte with the right block
    const otherType = selectQuorumMembers({
      llmqType: vector.llmqType + 1,
      size: vector.size,
      useRotation: false,
      v20Active: false,
      cycleBaseBlockHash: vector.cycleBaseBlockHash,
      masternodes: fixture.masternodes,
    });
    expect(otherType).not.toEqual(expected);
  });

  it('does not depend on the order the masternode list arrived in', () => {
    const vector = fixture.vectors[1]!;
    const shuffled = [...fixture.masternodes].reverse();
    expect(select(vector, shuffled)).toEqual(select(vector));
  });

  it('selects everyone when the profile is larger than the network, in score order', () => {
    const vector = fixture.vectors.find((entry) => entry.llmqName === 'llmq_400_60')!;
    expect(select(vector)).toHaveLength(fixture.masternodes.length);
  });
});

describe('eligibility, exactly as CalculateScores skips members', () => {
  const vector = fixture.vectors[0]!;
  const expected = vector.expectedMemberIndexes.map((index) => fixture.masternodes[index]!.proTxHash);

  it('never scores a banned masternode, so the next-best candidate moves in', () => {
    const banned = expected[0]!;
    const masternodes = fixture.masternodes.map((mn) => (mn.proTxHash === banned ? { ...mn, isValid: false } : mn));
    const selected = select(vector, masternodes);
    expect(selected).not.toContain(banned);
    expect(selected).toHaveLength(vector.size);
    expect(selected.slice(0, vector.size - 1)).toEqual(expected.slice(1));
  });

  it('never scores an unconfirmed masternode (all-zero confirmedHash)', () => {
    const unconfirmed = expected[3]!;
    const masternodes = fixture.masternodes.map((mn) =>
      mn.proTxHash === unconfirmed ? { ...mn, confirmedHash: '0'.repeat(64) } : mn
    );
    expect(select(vector, masternodes)).not.toContain(unconfirmed);
  });

  it('refuses a duplicated proTxHash instead of scoring it twice', () => {
    expect(() => select(vector, [...fixture.masternodes, fixture.masternodes[0]!])).toThrow(/twice/);
  });

  it('refuses the two selection paths it does not reproduce', () => {
    const base = {
      llmqType: 1, size: 50, cycleBaseBlockHash: vector.cycleBaseBlockHash, masternodes: fixture.masternodes,
    };
    expect(() => selectQuorumMembers({ ...base, useRotation: true, v20Active: false })).toThrow(/rotated/);
    expect(() => selectQuorumMembers({ ...base, useRotation: false, v20Active: true })).toThrow(/v20/);
  });
});

describe('the arithmetic the node sorts by', () => {
  it('compares 256-bit values little-endian: the last byte is the most significant', () => {
    const low = Buffer.alloc(32, 0xff);
    low[31] = 0x00;
    const high = Buffer.alloc(32, 0x00);
    high[31] = 0x01;
    expect(compareArith256(high, low)).toBeGreaterThan(0);
    expect(compareArith256(low, high)).toBeLessThan(0);
    expect(compareArith256(low, Buffer.from(low))).toBe(0);
  });

  it('is SHA256d over the type byte and the internal (reversed) block hash', () => {
    // A hash the node printed: getblockhash 8304 on the devnet. Reversing it
    // before hashing is the byte-order rule ZMQ taught this project the hard
    // way; both directions are pinned here so a refactor cannot flip it.
    const modifier = quorumSelectionModifier(1, fixture.vectors[0]!.cycleBaseBlockHash);
    expect(modifier).toHaveLength(32);
    expect(modifier.equals(quorumSelectionModifier(7, fixture.vectors[0]!.cycleBaseBlockHash))).toBe(false);
    expect(() => quorumSelectionModifier(256, fixture.vectors[0]!.cycleBaseBlockHash)).toThrow(/uint8/);
  });

  it('breaks an equal score by collateral outpoint, descending, and refuses without one', () => {
    const score = Buffer.alloc(32, 7);
    const a = { proTxHash: 'a'.repeat(64), score, collateral: { hash: '0'.repeat(63) + '1', index: 0 } };
    const b = { proTxHash: 'b'.repeat(64), score, collateral: { hash: '0'.repeat(63) + '2', index: 0 } };
    // b's outpoint hash is larger, so b sorts first in the node's reversed order.
    expect([a, b].sort(compareQuorumScores).map((entry) => entry.proTxHash)).toEqual([b.proTxHash, a.proTxHash]);
    const sameHash = { ...a, collateral: { hash: a.collateral.hash, index: 3 } };
    expect([a, sameHash].sort(compareQuorumScores)[0]).toBe(sameHash);
    expect(() => compareQuorumScores({ ...a, collateral: null }, b)).toThrow(/tie-break/);
  });
});
