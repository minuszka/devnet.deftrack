import { describe, expect, it } from 'vitest';
import { isSeparateShell, matchRoute, NAV_GROUPS, navLocation, roundHref, ROUTES } from './router.js';

describe('matchRoute', () => {
  it('matches the sections', () => {
    expect(matchRoute('/').route.tag).toBe('dd-page-overview');
    expect(matchRoute('/rounds').route.tag).toBe('dd-page-rounds');
    expect(matchRoute('/pose').route.tag).toBe('dd-page-pose');
  });

  it('ignores a trailing slash', () => {
    expect(matchRoute('/rounds/').route.tag).toBe('dd-page-rounds');
  });

  /*
   * This used to assert the opposite -- that an unknown path fell back to the
   * overview -- and that fallback was the bug. The reader followed a stale link
   * and landed on the front page with nothing saying why, so a dead link was
   * indistinguishable from a working one. The expectation is replaced because
   * the contract changed, not to make a red test go away.
   */
  it('names an unknown path instead of substituting the overview', () => {
    const match = matchRoute('/nowhere');
    expect(match.status).toBe('not-found');
    expect(match.route.tag).toBe('dd-page-not-found');
    expect(match.param).toBeNull();
    expect(match.path).toBe('/nowhere');
  });

  it('never claims a section is the current one while reporting not found', () => {
    const match = matchRoute('/nowhere');
    expect(ROUTES.map((r) => r.path)).not.toContain(match.route.path);
  });

  /*
   * `decodeURIComponent` throws a URIError on a truncated escape, and the shell
   * calls matchRoute while constructing itself: the throw meant the custom
   * element never upgraded and the whole page was blank.
   */
  it('reports a malformed escape rather than throwing', () => {
    for (const path of ['/round/%', '/tx/%E0%A4%A', '/block/%zz', '/experiments/%']) {
      const match = matchRoute(path);
      expect(match.status).toBe('malformed');
      expect(match.route.tag).toBe('dd-page-not-found');
      expect(match.param).toBeNull();
      expect(match.path).toBe(path);
    }
  });

  it('does not mistake a valid escape for a malformed one', () => {
    expect(matchRoute('/round/7%3A7416%3A0').status).toBe('matched');
    expect(matchRoute('/').status).toBe('matched');
    expect(matchRoute('/rounds/').status).toBe('matched');
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

describe('separate shells', () => {
  /*
   * `/admin` is chosen by main.ts from the pathname at load time, so the link
   * interceptor must leave it to the browser. Pushing the path instead would
   * change the address without ever loading that shell, and this router has no
   * route for it -- so a link that works when typed would answer "page not
   * found" when clicked.
   */
  it('names the paths this router must not intercept', () => {
    expect(isSeparateShell('/admin')).toBe(true);
    expect(isSeparateShell('/admin/')).toBe(true);
    expect(isSeparateShell('/admin/runs')).toBe(false);
    expect(isSeparateShell('/rounds')).toBe(false);
    expect(isSeparateShell('/')).toBe(false);
  });

  it('has no route of its own for it, which is why the rule is needed', () => {
    expect(matchRoute('/admin').status).toBe('not-found');
  });
});

describe('the grouped menu', () => {
  /*
   * The groups are fixed by the plan, labels and order both. Written out here
   * in full rather than derived, because a test that reads the grouping back
   * from ROUTES would agree with any grouping at all.
   */
  it('has exactly the four groups the plan fixes, in order', () => {
    expect(NAV_GROUPS.map((g) => [g.label, g.routes.map((r) => r.label)])).toEqual([
      ['Overview', ['Overview']],
      [
        'Network',
        ['DKG Rounds', 'PoSe Watch', 'Masternodes', 'ChainLocks', 'Sentinel Layer', 'Staking', 'Vantage Points', 'Operators', 'Fairness'],
      ],
      ['Blockchain', ['Blocks', 'Transactions']],
      ['Experiments', ['Experiments', 'Simulations']],
    ]);
  });

  it('puts every menu entry in exactly one group', () => {
    const visible = ROUTES.filter((r) => !r.hidden).map((r) => r.path);
    const grouped = NAV_GROUPS.flatMap((g) => g.routes.map((r) => r.path));
    expect([...grouped].sort()).toEqual([...visible].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it('keeps the original paths', () => {
    expect(NAV_GROUPS.flatMap((g) => g.routes.map((r) => r.path))).toEqual([
      '/', '/rounds', '/pose', '/masternodes', '/chainlocks', '/dsl', '/staking', '/peers', '/operators', '/fairness',
      '/blocks', '/txs', '/experiments', '/simulations',
    ]);
  });

  it('lights the page itself as the current page', () => {
    const where = navLocation(matchRoute('/pose'));
    expect(where.group?.label).toBe('Network');
    expect(where.entry?.label).toBe('PoSe Watch');
    expect(where.exact).toBe(true);
  });

  /*
   * A single round lit nothing at all, because its path is /round and the menu
   * entry's is /rounds. A single experiment lit Experiments only because the
   * two share a path.
   */
  it('lights the section a detail page belongs to, as a location rather than the page', () => {
    const cases: Array<[string, string, string]> = [
      ['/round/7%3A7416%3A0', 'Network', 'DKG Rounds'],
      ['/block/00abc', 'Blockchain', 'Blocks'],
      ['/tx/00def', 'Blockchain', 'Transactions'],
      ['/experiments/run-key-1', 'Experiments', 'Experiments'],
      [`/simulations/sim_${'1'.repeat(32)}`, 'Experiments', 'Simulations'],
    ];
    for (const [path, group, entry] of cases) {
      const where = navLocation(matchRoute(path));
      expect([where.group?.label, where.entry?.label, where.exact], path).toEqual([group, entry, false]);
    }
  });

  // Detail routes are the ones with an identifier in the path. The two
  // standalone pages (search, how we measure) are hidden too, and belong to no
  // section by design -- see the next test.
  it('gives every detail route a section to belong under', () => {
    for (const route of ROUTES.filter((r) => r.pattern)) {
      expect(route.section, route.label).toBeDefined();
      expect(ROUTES.some((r) => !r.hidden && r.path === route.section), route.label).toBe(true);
    }
  });

  it('routes the two standalone pages, and lights nothing for them', () => {
    for (const [path, tag] of [['/search', 'dd-page-search'], ['/methodology', 'dd-page-methodology']] as const) {
      const match = matchRoute(path);
      expect(match.status, path).toBe('matched');
      expect(match.route.tag, path).toBe(tag);
      expect(navLocation(match), path).toEqual({ group: null, entry: null, exact: false });
    }
    // The query string is not part of the route.
    expect(matchRoute('/search').route.tag).toBe('dd-page-search');
  });

  it('lights nothing for a page that could not be found or read', () => {
    for (const path of ['/nowhere', '/round/%']) {
      expect(navLocation(matchRoute(path))).toEqual({ group: null, entry: null, exact: false });
    }
  });
});
