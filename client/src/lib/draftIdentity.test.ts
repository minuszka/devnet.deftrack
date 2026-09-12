import { describe, expect, it } from 'vitest';
import { canonicalJson, draftFingerprint, draftScope } from './draftIdentity.js';

/**
 * The draft that produced the defect: the seed is constant across all of these,
 * which is exactly why scoping the key to the seed could not tell them apart.
 */
function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    network: 'regtest',
    mode: 'dry-run',
    scenario: {
      scenarioId: 'mn-stop',
      scenarioVersion: 1,
      seed: 'fixture-seed',
      parameters: { count: 1, durationSeconds: 60 },
    },
    ...overrides,
  };
}

describe('canonicalJson', () => {
  it('orders keys, so the same request written two ways is one request', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe(canonicalJson({ b: 1, a: 2 }));
  });

  /*
   * By code unit, not by locale. The server says why in `codeUnitOrder.ts`:
   * a canonical form that depends on the runtime's ICU build is not canonical,
   * and these two pairs are the ones that actually differ between the rules.
   */
  it('orders by code unit rather than by collation', () => {
    expect(canonicalJson({ 'a-zz': 1, a_0b0: 2 })).toBe('{"a-zz":1,"a_0b0":2}');
  });

  it('drops undefined members, as the server does', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('keeps nulls, which are a value', () => {
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
  });

  it('recurses into arrays and objects', () => {
    expect(canonicalJson({ xs: [{ b: 1, a: 2 }, 'x', true] })).toBe('{"xs":[{"a":2,"b":1},"x",true]}');
  });

  it('refuses a value no fingerprint could reproduce', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
    expect(() => canonicalJson({ a: () => 1 })).toThrow(/function/);
  });
});

describe('draftFingerprint', () => {
  it('is the same for the same request, so an uncertain retry is a retry', () => {
    expect(draftFingerprint(draft())).toBe(draftFingerprint(draft()));
  });

  it('survives a reordering, because the server fingerprints the same way', () => {
    const reordered = {
      scenario: {
        parameters: { durationSeconds: 60, count: 1 },
        seed: 'fixture-seed',
        scenarioVersion: 1,
        scenarioId: 'mn-stop',
      },
      mode: 'dry-run',
      network: 'regtest',
    };
    expect(draftFingerprint(reordered)).toBe(draftFingerprint(draft()));
  });

  /*
   * The defect, field by field. Every one of these left the key unchanged when
   * it was scoped to the seed, and every one of them is a different body -- so
   * every one of them would have been refused by the server under the old key.
   */
  it('changes when any part of the request changes', () => {
    const base = draftFingerprint(draft());
    const others = [
      draft({ network: 'devnet' }),
      draft({ mode: 'live' }),
      draft({
        scenario: { scenarioId: 'dsl-fault', scenarioVersion: 1, seed: 'fixture-seed', parameters: { count: 1, durationSeconds: 60 } },
      }),
      draft({
        scenario: { scenarioId: 'mn-stop', scenarioVersion: 2, seed: 'fixture-seed', parameters: { count: 1, durationSeconds: 60 } },
      }),
      // The one the review reproduced: only `count` moves.
      draft({
        scenario: { scenarioId: 'mn-stop', scenarioVersion: 1, seed: 'fixture-seed', parameters: { count: 2, durationSeconds: 60 } },
      }),
    ];
    for (const other of others) expect(draftFingerprint(other)).not.toBe(base);
    expect(new Set(others.map(draftFingerprint)).size).toBe(others.length);
  });

  it('also changes with the seed, which was the only thing it used to follow', () => {
    expect(
      draftFingerprint(
        draft({ scenario: { scenarioId: 'mn-stop', scenarioVersion: 1, seed: 'another-seed', parameters: { count: 1, durationSeconds: 60 } } })
      )
    ).not.toBe(draftFingerprint(draft()));
  });

  it('fits inside the key the server accepts', () => {
    // `admin-panel:` + scope + `:create:` + a uuid, against the server's 200.
    const key = `admin-panel:${draftScope(draft())}:create:${'0'.repeat(36)}`;
    expect(key.length).toBeLessThanOrEqual(200);
    expect(key.length).toBeGreaterThanOrEqual(8);
  });

  it('names a scope that says what it is', () => {
    expect(draftScope(draft())).toMatch(/^draft:[0-9a-f]{32}$/);
  });
});
