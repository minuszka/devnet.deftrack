import { describe, expect, it } from 'vitest';
import { commitmentPunishedCount, selectedQuorumSize } from './commitmentPunishment.js';

/** A validMembers bitfield for `size` selected members, as the RPC hex-encodes it. */
const bitfield = (size: number) => '0'.repeat(Math.ceil(size / 8) * 2);

describe('commitment punishment', () => {
  it('counts the members whose validMembers bit is false', () => {
    // 50-member quorum, 47 valid: three were punished.
    expect(commitmentPunishedCount(47, selectedQuorumSize(50, bitfield(50)))).toBe(3);
  });

  it('reports nothing for a healthy full quorum', () => {
    expect(commitmentPunishedCount(50, selectedQuorumSize(50, bitfield(50)))).toBe(0);
    expect(commitmentPunishedCount(60, selectedQuorumSize(60, bitfield(60)))).toBe(0);
  });

  it('does not punish anybody for a null commitment', () => {
    // The failed-DKG marker: zero valid members, and Core's punishment loop is
    // guarded on a non-null commitment.
    expect(commitmentPunishedCount(0, selectedQuorumSize(50, bitfield(50)))).toBe(0);
  });

  it('holds a quorum to the members it actually selected, not the profile size', () => {
    // The regression this module exists to prevent: llmq_400_60 nominally seats
    // 400 and forms with 80 here. Charging it the profile size would report a
    // perfectly healthy quorum as 320 members punished.
    const selected = selectedQuorumSize(400, bitfield(80));
    expect(selected).toBe(80);
    expect(commitmentPunishedCount(80, selected)).toBe(0);
    expect(commitmentPunishedCount(75, selected)).toBe(5);
  });

  it('never lets the bitfield bound exceed the profile size', () => {
    // 50 bits round up to 7 bytes = 56; the profile still caps the answer at 50.
    expect(selectedQuorumSize(50, bitfield(50))).toBe(50);
  });

  it('falls back to the profile size when the bitfield is absent', () => {
    expect(selectedQuorumSize(60, undefined)).toBe(60);
    expect(selectedQuorumSize(60, '')).toBe(60);
  });

  it('reports zero rather than a guess for an unknown profile', () => {
    expect(selectedQuorumSize(null, bitfield(80))).toBeNull();
    expect(commitmentPunishedCount(70, null)).toBe(0);
  });

  it('never returns a negative count', () => {
    // valid can momentarily exceed a byte-rounded bound; the floor is zero.
    expect(commitmentPunishedCount(90, selectedQuorumSize(400, bitfield(80)))).toBe(0);
  });
});
