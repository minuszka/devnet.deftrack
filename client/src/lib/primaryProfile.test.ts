import { describe, expect, it } from 'vitest';
import { primaryProfile } from './primaryProfile.js';

const signers = { v1: 'llmq_400_60', v2: 'llmq_defcon', activationHeight: 3_240 };

/**
 * The front page asked for the health timeline with no profile at all, so the
 * formation rate, the median and worst health and the failure streak were
 * computed across five interleaved schedules at once. Blending them invents
 * streaks no type ever had.
 */
describe('which profile the overview is about', () => {
  it('is the ChainLock profile in force at the tip', () => {
    expect(primaryProfile({ signers, tipHeight: 3_239 })).toMatchObject({
      known: true,
      llmqName: 'llmq_400_60',
    });
    expect(primaryProfile({ signers, tipHeight: 3_240 })).toMatchObject({
      known: true,
      llmqName: 'llmq_defcon',
    });
  });

  it('switches exactly at the activation height, not after it', () => {
    // The resolver is height-only and one-way, and the node decides on the
    // signed height being at or above the gate.
    expect(primaryProfile({ signers, tipHeight: 3_240 })).toMatchObject({
      reason: 'after-activation',
    });
    expect(primaryProfile({ signers, tipHeight: 3_239 })).toMatchObject({
      reason: 'before-activation',
    });
  });

  it('answers unknown rather than guessing, when the signers are unavailable', () => {
    // A figure covering five schedules is worse than no figure, because it
    // looks like an answer. The page shows the reason instead.
    expect(primaryProfile({ signers: null, tipHeight: 8_000 })).toEqual({
      known: false,
      reason: 'no-signers',
    });
  });

  it('answers unknown when there is no tip to compare against', () => {
    expect(primaryProfile({ signers, tipHeight: null })).toEqual({ known: false, reason: 'no-tip' });
    // Not zero, either: a missing tip that defaulted to 0 would silently pick
    // the pre-activation profile and look like a real answer.
    expect(primaryProfile({ signers, tipHeight: undefined })).toEqual({
      known: false,
      reason: 'no-tip',
    });
  });
});
