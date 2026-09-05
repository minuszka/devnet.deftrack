import { describe, expect, it } from 'vitest';
import { matchRoute, roundHref, ROUTES } from './router.js';

describe('matchRoute', () => {
  it('matches the sections', () => {
    expect(matchRoute('/').route.tag).toBe('dd-page-overview');
    expect(matchRoute('/rounds').route.tag).toBe('dd-page-rounds');
    expect(matchRoute('/pose').route.tag).toBe('dd-page-pose');
  });

  it('ignores a trailing slash', () => {
    expect(matchRoute('/rounds/').route.tag).toBe('dd-page-rounds');
  });

  it('falls back to the overview rather than rendering nothing', () => {
    expect(matchRoute('/nowhere').route.tag).toBe('dd-page-overview');
  });

  // The one that could plausibly break: a round key is `<type>:<height>:<index>`,
  // and /rounds must not be swallowed by /round/:id or the section disappears.
  it('keeps the round list and a single round apart', () => {
    expect(matchRoute('/rounds').route.tag).toBe('dd-page-rounds');
    expect(matchRoute('/round/7%3A7416%3A0').route.tag).toBe('dd-page-round');
  });

  it('hands the page a decoded round key', () => {
    const match = matchRoute(roundHref('7:7416:0'));
    expect(match.route.tag).toBe('dd-page-round');
    expect(match.param).toBe('7:7416:0');
  });

  it('also carries a quorum hash, which the endpoint accepts too', () => {
    const hash = '000000000000000abc123def4567890000000000000000000000000000000000';
    expect(matchRoute(roundHref(hash)).param).toBe(hash);
  });

  it('matches an experiment and a block by their own patterns', () => {
    expect(matchRoute('/experiments/run-key-1').param).toBe('run-key-1');
    expect(matchRoute('/block/00abc').route.tag).toBe('dd-page-block');
    expect(matchRoute('/tx/00def').route.tag).toBe('dd-page-tx');
  });

  it('keeps detail routes out of the menu', () => {
    const menu = ROUTES.filter((r) => !r.hidden).map((r) => r.path);
    expect(menu).toContain('/rounds');
    expect(menu).not.toContain('/round');
    expect(menu).not.toContain('/block');
  });
});

describe('roundHref', () => {
  it('encodes the colons a round key is built from', () => {
    expect(roundHref('7:7416:0')).toBe('/round/7%3A7416%3A0');
  });
});
