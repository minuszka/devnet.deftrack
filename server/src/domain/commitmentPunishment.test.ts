import { describe, expect, it } from 'vitest';
import { commitmentPunishedCount } from './commitmentPunishment.js';

describe('commitment punishment', () => {
  it('counts the selected members whose validMembers bit is false', () => {
    // 50 members selected, 47 valid: three were punished.
    expect(commitmentPunishedCount(47, 50)).toBe(3);
  });

  it('reports nothing for a healthy full quorum', () => {
    expect(commitmentPunishedCount(50, 50)).toBe(0);
    expect(commitmentPunishedCount(60, 60)).toBe(0);
  });

  it('does not punish anybody for a null commitment', () => {
    // The failed-DKG marker: zero valid members, and Core's punishment loop is
    // guarded on a non-null commitment.
    expect(commitmentPunishedCount(0, 50)).toBe(0);
  });

  it('knows a null commitment punished nobody even when its member list cannot be resolved', () => {
    // No quorum is built for a failed DKG, so `quorum info` has nothing to say
    // about it; zero is still the answer. Reading it as unknown had blanked
    // 3145 of the 3632 unresolved rows on the lab.
    expect(commitmentPunishedCount(0, null)).toBe(0);
  });

  it('holds a quorum to the members it selected, not the seats its profile defines', () => {
    // The regression this module exists to prevent: llmq_400_60 nominally seats
    // 400 and forms with 80 here. Charging it 400 would report a perfectly
    // healthy quorum as 320 members punished -- and the validMembers bitfield is
    // no help, because it is allocated at the profile size, 400 bits wide.
    expect(commitmentPunishedCount(80, 80)).toBe(0);
    expect(commitmentPunishedCount(75, 80)).toBe(5);
  });

  it('answers unknown rather than guessing when the member list cannot be resolved', () => {
    expect(commitmentPunishedCount(70, null)).toBeNull();
  });

  it('never returns a negative count', () => {
    expect(commitmentPunishedCount(90, 80)).toBe(0);
  });
});
