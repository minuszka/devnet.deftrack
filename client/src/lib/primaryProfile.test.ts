import { describe, expect, it } from 'vitest';
import { primaryProfile, profileUnknownReason } from './primaryProfile.js';

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

describe('why the profile is unknown', () => {
  it('keeps a report that could not be read apart from a report with no signers', () => {
    const noSigners = { known: false as const, reason: 'no-signers' as const };
    expect(profileUnknownReason(noSigners, {})).toBe('no ChainLock report');
    expect(profileUnknownReason(noSigners, { signers: 'HTTP 503' })).toBe('the ChainLock report could not be read: HTTP 503');
  });

  it('does the same for the chain tip', () => {
    const noTip = { known: false as const, reason: 'no-tip' as const };
    expect(profileUnknownReason(noTip, {})).toBe('no chain tip');
    expect(profileUnknownReason(noTip, { tip: 'timed out' })).toBe('the chain tip could not be read: timed out');
  });

  it('names the failure that decided the answer, not another one', () => {
    // The signers are asked about first; a failed tip read beside a missing
    // signer list is not the reason the profile is unknown.
    expect(profileUnknownReason({ known: false, reason: 'no-signers' }, { tip: 'timed out' })).toBe('no ChainLock report');
  });
});
