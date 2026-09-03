import { describe, expect, it } from 'vitest';
import { LLMQ_PROFILES } from '../config/llmq.js';
import { BLOCK_SECONDS } from '../domain/dkgWindows.js';
import { assessDkgAnchor, dkgAnchorRefusal, measuresDkgWindows } from './dkgAnchorGate.js';

const PROFILE = LLMQ_PROFILES.llmq_50_60!; // interval 24, phase 2
const minutes = (n: number) => n * 60_000;

describe('measuresDkgWindows', () => {
  it('is only the scenario that asks the DKG question', () => {
    expect(measuresDkgWindows('quorum-member-outage', { phase: 'dkg' })).toBe(true);
    // A ChainLock-phase run of the same scenario measures signing, not the DKG.
    expect(measuresDkgWindows('quorum-member-outage', { phase: 'chainlock' })).toBe(false);
    expect(measuresDkgWindows('mn-stop', { phase: 'dkg' })).toBe(false);
    expect(measuresDkgWindows('network-degradation', null)).toBe(false);
  });
});

describe('assessDkgAnchor', () => {
  it('sees a short outage landing on a window, and the same outage missing it', () => {
    // Windows sit at [24k+2, 24k+4). Starting at 24k+2 with two blocks covers
    // one; starting one block later covers none, at identical length.
    const onWindow = assessDkgAnchor({
      tipHeight: 24 * 40 + 1,
      faultDurationMs: 2 * BLOCK_SECONDS * 1_000,
      profile: PROFILE,
    });
    expect(onWindow.windowsCovered).toBe(1);

    const missed = assessDkgAnchor({
      tipHeight: 24 * 40 + 2,
      faultDurationMs: 2 * BLOCK_SECONDS * 1_000,
      profile: PROFILE,
    });
    expect(missed.windowsCovered).toBe(0);
    expect(missed.blocksToWait).toBeGreaterThan(0);
  });

  it('points at a start height that actually covers a window', () => {
    for (let tip = 1_000; tip < 1_030; tip++) {
      const assessment = assessDkgAnchor({
        tipHeight: tip,
        faultDurationMs: 2 * BLOCK_SECONDS * 1_000,
        profile: PROFILE,
      });
      const fromSuggested = assessDkgAnchor({
        tipHeight: assessment.suggestedStartHeight - 1,
        faultDurationMs: 2 * BLOCK_SECONDS * 1_000,
        profile: PROFILE,
      });
      expect(fromSuggested.windowsCovered).toBe(1);
    }
  });
});

describe('dkgAnchorRefusal', () => {
  const base = {
    scenarioId: 'quorum-member-outage',
    parameters: { phase: 'dkg' },
    faultDurationMs: 2 * BLOCK_SECONDS * 1_000,
    profile: PROFILE,
  };

  it('refuses an outage that would stop masternodes and measure nothing', () => {
    const reason = dkgAnchorRefusal({ ...base, tipHeight: 24 * 40 + 2 });
    expect(reason).toMatch(/would cover no llmq_50_60 contribution window/);
    expect(reason).toMatch(/start at height \d+/);
  });

  it('allows the same run once it is aligned', () => {
    expect(dkgAnchorRefusal({ ...base, tipHeight: 24 * 40 + 1 })).toBeNull();
  });

  it('never refuses a scenario that is not asking the DKG question', () => {
    expect(dkgAnchorRefusal({ ...base, scenarioId: 'mn-stop', tipHeight: 24 * 40 + 2 })).toBeNull();
    expect(
      dkgAnchorRefusal({ ...base, parameters: { phase: 'chainlock' }, tipHeight: 24 * 40 + 2 })
    ).toBeNull();
  });

  it('fails open when the tip is unknown', () => {
    // This gate protects the value of a measurement, not the network. A
    // deployment with no tip source keeps the behaviour it had.
    expect(dkgAnchorRefusal({ ...base, tipHeight: null })).toBeNull();
  });

  it('allows a long outage that must cover a window wherever it starts', () => {
    const longEnough = { ...base, faultDurationMs: minutes(70) };
    for (let tip = 1_000; tip < 1_024; tip++) {
      expect(dkgAnchorRefusal({ ...longEnough, tipHeight: tip })).toBeNull();
    }
  });
});
