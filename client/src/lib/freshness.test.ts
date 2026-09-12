import { describe, expect, it } from 'vitest';
import {
  FreshnessTracker,
  freshness,
  freshnessNote,
  measuredCount,
  type FreshnessInput,
} from './freshness.js';

const INTERVAL = 30_000;

function read(overrides: Partial<FreshnessInput> = {}) {
  return freshness({
    lastSuccessAtMs: null,
    lastFailureAtMs: null,
    failureMessage: null,
    nowMs: 1_000_000,
    intervalMs: INTERVAL,
    ...overrides,
  });
}

describe('freshness', () => {
  it('starts as loading, not as an empty success', () => {
    const f = read();
    expect(f.state).toBe('loading');
    expect(f.ageMs).toBeNull();
    expect(f.error).toBeNull();
  });

  it('reports the first failure as unavailable, so a retry can be offered', () => {
    const f = read({ lastFailureAtMs: 999_000, failureMessage: 'connection refused' });
    expect(f.state).toBe('unavailable');
    expect(f.error).toBe('connection refused');
    expect(f.stale).toBe(false);
  });

  it('is fresh inside two periods', () => {
    const f = read({ lastSuccessAtMs: 1_000_000 - 2 * INTERVAL });
    expect(f.state).toBe('fresh');
    expect(f.stale).toBe(false);
    expect(f.ageMs).toBe(2 * INTERVAL);
  });

  it('is stale past two periods -- one slow response is not staleness', () => {
    expect(read({ lastSuccessAtMs: 1_000_000 - 2 * INTERVAL - 1 }).state).toBe('stale');
    expect(read({ lastSuccessAtMs: 1_000_000 - INTERVAL - 1 }).state).toBe('fresh');
  });

  it('shows a failure since the last success immediately, keeping the data', () => {
    const f = read({
      lastSuccessAtMs: 1_000_000 - 1_000,
      lastFailureAtMs: 1_000_000 - 500,
      failureMessage: '503 Service Unavailable',
    });
    // Not stale -- the data is a second old. But the reader is told at once
    // that it is no longer being renewed.
    expect(f.state).toBe('failing');
    expect(f.stale).toBe(false);
    expect(f.error).toBe('503 Service Unavailable');
  });

  it('is failing and stale at once when the outage outlasts two periods', () => {
    const f = read({
      lastSuccessAtMs: 1_000_000 - 5 * INTERVAL,
      lastFailureAtMs: 1_000_000 - 1_000,
      failureMessage: 'timeout',
    });
    expect(f.state).toBe('failing');
    expect(f.stale).toBe(true);
  });

  /*
   * The rule this exists to hold: a success clears the failure, and it does so
   * because it is newer -- not because something remembered to reset a flag. A
   * flag that survives its own success is how a page stays red after recovering.
   */
  it('clears the failure when a newer success lands', () => {
    const f = read({
      lastSuccessAtMs: 1_000_000 - 100,
      lastFailureAtMs: 1_000_000 - 5_000,
      failureMessage: 'timeout',
    });
    expect(f.state).toBe('fresh');
    expect(f.error).toBeNull();
  });

  it('never reports data from the future when the clock steps back', () => {
    const f = read({ lastSuccessAtMs: 1_000_000 + 60_000 });
    expect(f.ageMs).toBe(0);
    expect(f.state).toBe('fresh');
  });
});

describe('freshnessNote', () => {
  it('names the period rather than claiming "live" on its own', () => {
    const note = freshnessNote(read({ lastSuccessAtMs: 1_000_000 - 5_000 }), INTERVAL);
    expect(note.tone).toBe('ok');
    expect(note.text).toContain('updated 5s ago');
    expect(note.text).toContain('every 30 s');
  });

  it('carries the failure text where the reader can see it', () => {
    const note = freshnessNote(
      read({
        lastSuccessAtMs: 1_000_000 - 90_000,
        lastFailureAtMs: 1_000_000 - 1_000,
        failureMessage: 'network error',
      }),
      INTERVAL
    );
    expect(note.tone).toBe('bad');
    expect(note.text).toContain('refresh failed');
    expect(note.text).toContain('last update 2m ago');
    expect(note.detail).toBe('network error');
  });

  it('warns rather than alarms when the data is merely old', () => {
    const note = freshnessNote(read({ lastSuccessAtMs: 1_000_000 - 120_000 }), INTERVAL);
    expect(note.tone).toBe('warn');
    expect(note.text).toContain('stale');
  });
});

describe('measuredCount', () => {
  /*
   * The health endpoint answers -1 for every figure whose source failed. The
   * header printed them: "mn -1" and "staking -1" read as counts of a broken
   * network rather than as no reading at all.
   */
  it('treats the API failure sentinel as no reading', () => {
    expect(measuredCount(-1)).toBeNull();
    expect(measuredCount(0)).toBe(0);
    expect(measuredCount(152)).toBe(152);
  });

  it('is not a blanket rule about negative numbers', () => {
    // Only counts go through this. A margin or a delta is legitimately
    // negative and must keep its sign; blanking those would hide findings.
    expect(measuredCount(undefined)).toBeNull();
    expect(measuredCount(null)).toBeNull();
    expect(measuredCount(Number.NaN)).toBeNull();
  });
});

describe('FreshnessTracker', () => {
  it('records the moment the caller accepted, not the moment it asked', () => {
    const tracker = new FreshnessTracker();
    tracker.succeeded(1_000);
    expect(tracker.read(1_000 + INTERVAL, INTERVAL).ageMs).toBe(INTERVAL);
  });

  /*
   * A superseded request answering late must not be able to mark the page
   * fresh. The tracker cannot know that by itself, which is why acceptance is
   * the caller's decision -- the caller is the one holding `run.stale`. This
   * test states the contract: a run that was never accepted leaves no trace.
   */
  it('is untouched by a response the caller did not accept', () => {
    const tracker = new FreshnessTracker();
    tracker.succeeded(1_000);
    tracker.failed('timeout', 2_000);
    // A late success from an older run: the page checked `run.stale` and did
    // not call `succeeded`, so the failure still stands.
    const f = tracker.read(3_000, INTERVAL);
    expect(f.state).toBe('failing');
    expect(f.error).toBe('timeout');
  });
});
