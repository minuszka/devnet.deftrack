import { describe, expect, it } from 'vitest';
import { ApiError } from './api.js';
import { classifyFailure, parseSearch, soleMatch, type Candidate, type Outcome } from './search.js';

const HASH = `${'ab'.repeat(31)}cd`;

describe('what a search looks up', () => {
  it('asks nothing for an empty or blank query', () => {
    expect(parseSearch('')).toEqual({ kind: 'empty' });
    expect(parseSearch('   \t  ')).toEqual({ kind: 'empty' });
  });

  it('reads digits as a height, and also asks for an experiment by that key', () => {
    const parsed = parseSearch(' 11500 ');
    expect(parsed).toEqual({
      kind: 'lookup',
      query: '11500',
      candidates: [
        { target: 'block', id: '11500' },
        { target: 'experiment', id: '11500' },
      ],
      couldBeProTxHash: false,
    });
  });

  it('sends a height without its leading zeros', () => {
    const parsed = parseSearch('0042');
    expect(parsed.kind === 'lookup' && parsed.candidates[0]).toEqual({ target: 'block', id: '42' });
  });

  /*
   * The rule the search is built on: 64 hex characters are a block hash, a
   * transaction id or a proTxHash, and the shape cannot say which.
   */
  it('never decides a 64-hex string from its shape: block and transaction are both asked', () => {
    const parsed = parseSearch(HASH.toUpperCase());
    expect(parsed.kind).toBe('lookup');
    if (parsed.kind !== 'lookup') return;
    expect(parsed.candidates.filter((c) => c.target === 'block' || c.target === 'tx')).toEqual([
      { target: 'block', id: HASH },
      { target: 'tx', id: HASH },
    ]);
    expect(parsed.couldBeProTxHash).toBe(true);
  });

  it('reads a simulation run key as a simulation -- and, by the same rule, asks experiments too', () => {
    const key = `sim_${'1'.repeat(32)}`;
    expect(parseSearch(key)).toEqual({
      kind: 'lookup',
      query: key,
      candidates: [
        { target: 'simulation', id: key },
        { target: 'experiment', id: key },
      ],
      couldBeProTxHash: false,
    });
  });

  it('reads anything else in the run-key alphabet as an experiment run key', () => {
    const parsed = parseSearch('dsl-outage-short-2026-09-11');
    expect(parsed.kind === 'lookup' && parsed.candidates).toEqual([{ target: 'experiment', id: 'dsl-outage-short-2026-09-11' }]);
  });

  it('refuses what none of them could be, without asking', () => {
    // (An underscore is in the server's run-key alphabet, so `sim_short` is a
    // well-formed experiment key, not a refusal.)
    for (const query of ['hello world', 'a/b', '<script>', `x${'a'.repeat(80)}`, '-leading-dash']) {
      expect(parseSearch(query).kind, query).toBe('unsupported');
    }
  });
});

describe('what a failed lookup means', () => {
  const candidate: Candidate = { target: 'tx', id: HASH };

  it('only a 404 is "not found"', () => {
    expect(classifyFailure(candidate, new ApiError(404, 'transaction not found'))).toEqual({ status: 'not-found', candidate });
  });

  it('any other status is "could not be checked", with the reason', () => {
    for (const status of [400, 401, 429, 500, 502, 503]) {
      const outcome = classifyFailure(candidate, new ApiError(status, 'nope'));
      expect(outcome?.status, String(status)).toBe('unverified');
      expect(outcome?.status === 'unverified' && outcome.reason).toContain(String(status));
    }
  });

  it('a request that never got an answer is "could not be checked" too', () => {
    const outcome = classifyFailure(candidate, new TypeError('Failed to fetch'));
    expect(outcome).toEqual({ status: 'unverified', candidate, reason: 'Failed to fetch' });
  });

  it('leaves an abort to the caller, who knows whether it was a timeout', () => {
    expect(classifyFailure(candidate, new DOMException('aborted', 'AbortError'))).toBeNull();
  });
});

describe('when a search goes straight to the item', () => {
  const found = (target: 'block' | 'tx'): Outcome => ({
    status: 'found',
    candidate: { target, id: HASH },
    found: { target, title: target, identifier: HASH, detail: '', href: `/${target}/${HASH}` },
  });
  const notFound: Outcome = { status: 'not-found', candidate: { target: 'experiment', id: HASH } };
  const unverified: Outcome = { status: 'unverified', candidate: { target: 'tx', id: HASH }, reason: 'HTTP 503' };

  it('goes when exactly one was found and everything else was checked', () => {
    expect(soleMatch([found('block'), notFound])?.href).toBe(`/block/${HASH}`);
  });

  it('stays when two were found', () => {
    expect(soleMatch([found('block'), found('tx')])).toBeNull();
  });

  it('stays when one was found but another could not be checked', () => {
    expect(soleMatch([found('block'), unverified])).toBeNull();
  });

  it('stays when nothing was found', () => {
    expect(soleMatch([notFound])).toBeNull();
  });
});
