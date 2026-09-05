import { describe, expect, it } from 'vitest';
import { roundSentence, roundVerdict } from './roundVerdict.js';

/**
 * The single most important thing this site says is the difference between a
 * round that did not happen and a round that happened and punished people.
 */
describe('how a round reads', () => {
  it('calls out the round that actually punished somebody', () => {
    const verdict = roundVerdict({ status: 'formed', punishedCount: 12 });
    expect(verdict.incident).toBe(true);
    expect(verdict.label).toContain('punished 12');
    // Amber, not green. The table used to show this as a green "formed" pill
    // with a plain 12 beside it -- the incident dressed as the good outcome.
    expect(verdict.tone).toBe('warn');
  });

  it('does not dress a clean round as an incident', () => {
    const verdict = roundVerdict({ status: 'formed', punishedCount: 0 });
    expect(verdict.incident).toBe(false);
    expect(verdict.tone).toBe('good');
    expect(verdict.punished).toBe('nobody');
  });

  it('says in words that a failed round punished nobody', () => {
    // A failed DKG mines no commitment, and the punishment loop is guarded by a
    // non-null commitment -- so nobody is punished. That is an assertion about
    // consensus, not a missing value, and a bare `0` reads as neither.
    const verdict = roundVerdict({ status: 'failed', punishedCount: 0 });
    expect(verdict.punished).toBe('nobody punished');
    expect(verdict.incident).toBe(false);
  });

  it('does not paint a failed round in the colour reserved for danger', () => {
    // It used to share the red pill with a banned masternode, so the
    // non-event was the loudest thing on the page and the real incident beside
    // it was green.
    expect(roundVerdict({ status: 'failed', punishedCount: 0 }).tone).toBe('muted');
    expect(roundVerdict({ status: 'impossible', punishedCount: 0 }).tone).toBe('muted');
  });

  it('distinguishes a round that could not form from one that failed to', () => {
    // `impossible` means the network was smaller than the profile's minSize, so
    // no session could run at all. Reading that as a failure is the fabrication
    // the collector goes to some length to avoid; the page must not undo it.
    expect(roundVerdict({ status: 'impossible', punishedCount: 0 }).label).toBe('could not form');
    expect(roundVerdict({ status: 'failed', punishedCount: 0 }).label).toBe('did not form');
  });

  it('leaves an undecided round undecided', () => {
    const verdict = roundVerdict({ status: 'pending', punishedCount: 0 });
    expect(verdict.punished).toBe('—');
    expect(verdict.incident).toBe(false);
  });

  it('never claims a punishment a failed round cannot have made', () => {
    // Belt and braces: even if a row arrived with a non-zero count against a
    // failed round -- which consensus does not permit -- the page must not
    // report it as an incident.
    const verdict = roundVerdict({ status: 'failed', punishedCount: 7 });
    expect(verdict.incident).toBe(false);
    expect(verdict.punished).toBe('nobody punished');
  });
});

describe('roundSentence', () => {
  it('says what a punishing round did, and against what ceiling', () => {
    const s = roundSentence({
      status: 'formed',
      punishedCount: 12,
      effectiveSize: 50,
      maxPossibleBan: 20,
    });
    expect(s).toContain('punished 12 of 50');
    expect(s).toContain('at most 20');
  });

  it('never leaves a clean round sounding like an incident', () => {
    expect(
      roundSentence({ status: 'formed', punishedCount: 0, effectiveSize: 50, maxPossibleBan: 20 })
    ).toBe('This round formed and punished nobody.');
  });

  // The sentence this whole site exists to be able to say.
  it('says outright that a failed round punished nobody', () => {
    const s = roundSentence({
      status: 'failed',
      punishedCount: 0,
      effectiveSize: null,
      maxPossibleBan: null,
    });
    expect(s).toContain('nobody was PoSe-punished');
  });

  it('keeps could-not-form apart from did-not-form', () => {
    const s = roundSentence({
      status: 'impossible',
      punishedCount: 0,
      effectiveSize: null,
      maxPossibleBan: null,
    });
    expect(s).toContain('formation gate');
    expect(s).not.toContain('punished');
  });
});
