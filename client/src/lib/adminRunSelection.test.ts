import { describe, expect, it } from 'vitest';
import {
  adminHref,
  decideSelection,
  isRunKey,
  runKeyFromSearch,
} from './adminRunSelection.js';

const A = `sim_${'a'.repeat(32)}`;
const B = `sim_${'b'.repeat(32)}`;

describe('isRunKey', () => {
  it('accepts what the server mints and nothing else', () => {
    expect(isRunKey(A)).toBe(true);
    expect(isRunKey(`sim_${'A'.repeat(32)}`)).toBe(false);
    expect(isRunKey(`sim_${'a'.repeat(31)}`)).toBe(false);
    expect(isRunKey('sim_')).toBe(false);
    expect(isRunKey('../admin')).toBe(false);
    expect(isRunKey(null)).toBe(false);
  });
});

describe('decideSelection', () => {
  it('takes the URL over everything, because a reload carries it', () => {
    const decision = decideSelection({ urlRunKey: A, heldRunKey: B, activeRunKeys: [B] });
    expect(decision).toEqual({ runKey: A, source: 'url', malformedRunKey: null });
  });

  /*
   * The bug this rule replaces: the dashboard recomputed the selection on every
   * poll as "first active run, or whatever was selected". Choosing B and
   * waiting one refresh moved the panel to A -- so the Abort button on screen
   * belonged to a run the operator had not chosen.
   */
  it('never moves a selection that is already held', () => {
    const decision = decideSelection({ urlRunKey: null, heldRunKey: B, activeRunKeys: [A] });
    expect(decision).toEqual({ runKey: B, source: 'held', malformedRunKey: null });
  });

  it('adopts an active run only when nothing was asked for', () => {
    const decision = decideSelection({ urlRunKey: null, heldRunKey: null, activeRunKeys: [A] });
    expect(decision).toEqual({ runKey: A, source: 'active', malformedRunKey: null });
  });

  it('selects nothing when there is nothing to select', () => {
    expect(decideSelection({ urlRunKey: null, heldRunKey: null, activeRunKeys: [] })).toEqual({
      runKey: null,
      source: 'none',
      malformedRunKey: null,
    });
  });

  /*
   * A malformed key must not fall through. Falling through is how an operator
   * ends up looking at -- and aborting -- a run they never asked for.
   */
  it('reports a malformed key instead of quietly choosing another run', () => {
    const decision = decideSelection({
      urlRunKey: 'not-a-run-key',
      heldRunKey: B,
      activeRunKeys: [A],
    });
    expect(decision).toEqual({ runKey: null, source: 'none', malformedRunKey: 'not-a-run-key' });
  });

  it('treats an empty parameter as absent rather than malformed', () => {
    expect(decideSelection({ urlRunKey: '', heldRunKey: B, activeRunKeys: [] }).runKey).toBe(B);
  });

  it('ignores an active entry that is not a run key', () => {
    const decision = decideSelection({
      urlRunKey: null,
      heldRunKey: null,
      activeRunKeys: ['garbage', A],
    });
    expect(decision.runKey).toBe(A);
  });
});

describe('adminHref', () => {
  it('carries the run key and nothing else', () => {
    expect(adminHref(A)).toBe(`/admin?run=${A}`);
    expect(adminHref(null)).toBe('/admin');
  });
});

describe('runKeyFromSearch', () => {
  it('reads the parameter, and survives a malformed query', () => {
    expect(runKeyFromSearch(`?run=${A}`)).toBe(A);
    expect(runKeyFromSearch('?run=&other=1')).toBe('');
    expect(runKeyFromSearch('')).toBeNull();
    expect(runKeyFromSearch('?%')).toBeNull();
  });
});
