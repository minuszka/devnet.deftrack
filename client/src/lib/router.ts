/**
 * Minimal history router.
 *
 * Deliberately not lazy-loading page modules the way SCAN does: the whole
 * bundle is well under 100 kB, so a second network round trip per navigation
 * would cost more than it saves.
 */

/** The four menu groups. Fixed by the plan; a path never moves because of them. */
export type NavGroupId = 'overview' | 'network' | 'blockchain' | 'experiments';

export interface Route {
  path: string;
  tag: string;
  label: string;
  /** Routable but absent from the menu -- detail pages are reached by link. */
  hidden?: boolean;
  /** One `:name` segment, matched against the path. */
  pattern?: RegExp;
  key?: string;
  /** Which menu group a menu entry sits in. Every visible route has one. */
  group?: NavGroupId;
  /**
   * For a detail route: the path of the menu entry it belongs under.
   *
   * Without it a single round, block or transaction lit nothing in the menu,
   * while a single experiment happened to light Experiments only because the
   * two share a path -- so whether the reader could see where they were depended
   * on an accident of naming.
   */
  section?: string;
}

/**
 * Why a path resolved the way it did.
 *
 * `not-found` and `malformed` are different failures and were both invisible.
 * An unknown path rendered the overview, so a stale link looked like a working
 * link to the front page; a malformed percent-escape threw out of `matchRoute`,
 * and because the shell calls it while constructing itself, the custom element
 * never upgraded and the page was simply blank.
 */
export type MatchStatus = 'matched' | 'not-found' | 'malformed';

export interface Match {
  route: Route;
  param: string | null;
  status: MatchStatus;
  /** The pathname this match was made from, verbatim -- shown by the error page. */
  path: string;
}

/*
 * Neither of these is in ROUTES: they are what a path resolves *to*, never
 * something a path resolves *from*. Their `path` exists only so the navigation's
 * `aria-current` comparison has something to not match -- which is why it is a
 * sentinel no section uses, rather than `/`. The overview tab staying unlit on a
 * "page not found" is the whole point.
 */
export const NOT_FOUND_ROUTE: Route = {
  path: '/__not-found',
  tag: 'dd-page-not-found',
  label: 'Not found',
  hidden: true,
};

export const MALFORMED_ROUTE: Route = {
  path: '/__broken-link',
  tag: 'dd-page-not-found',
  label: 'Broken link',
  hidden: true,
};

/**
 * `decodeURIComponent` throws a `URIError` on a truncated or invalid escape --
 * `/round/%` and `/tx/%E0%A4%A` both do. Narrow on purpose: one call, one
 * failure mode, and the caller is told which, rather than a catch that swallows
 * whatever else went wrong on the way past.
 */
function decodeParam(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export const ROUTES: Route[] = [
  { path: '/', tag: 'dd-page-overview', label: 'Overview', group: 'overview' },
  { path: '/rounds', tag: 'dd-page-rounds', label: 'DKG Rounds', group: 'network' },
  { path: '/pose', tag: 'dd-page-pose', label: 'PoSe Watch', group: 'network' },
  { path: '/masternodes', tag: 'dd-page-masternodes', label: 'Masternodes', group: 'network' },
  { path: '/chainlocks', tag: 'dd-page-chainlocks', label: 'ChainLocks', group: 'network' },
  { path: '/dsl', tag: 'dd-page-dsl', label: 'Sentinel Layer', group: 'network' },
  { path: '/staking', tag: 'dd-page-staking', label: 'Staking', group: 'network' },
  { path: '/peers', tag: 'dd-page-peers', label: 'Vantage Points', group: 'network' },
  { path: '/experiments', tag: 'dd-page-experiments', label: 'Experiments', group: 'experiments' },
  { path: '/simulations', tag: 'dd-page-simulations', label: 'Simulations', group: 'experiments' },
  { path: '/blocks', tag: 'dd-page-blocks', label: 'Blocks', group: 'blockchain' },
  { path: '/txs', tag: 'dd-page-txs', label: 'Transactions', group: 'blockchain' },
  { path: '/operators', tag: 'dd-page-operators', label: 'Operators', group: 'network' },
  { path: '/fairness', tag: 'dd-page-fairness', label: 'Fairness', group: 'network' },
  {
    path: '/experiments',
    tag: 'dd-page-experiments',
    label: 'Experiment',
    hidden: true,
    pattern: /^\/experiments\/([^/]+)$/,
    key: 'runKey',
    section: '/experiments',
  },
  {
    /**
     * Any segment, not only a well-formed run key: a malformed key is answered
     * by the page with "that is not a simulation run key", which says more
     * than a generic page-not-found would.
     */
    path: '/simulations',
    tag: 'dd-page-simulations',
    label: 'Simulation',
    hidden: true,
    pattern: /^\/simulations\/([^/]+)$/,
    key: 'runKey',
    section: '/simulations',
  },
  {
    /**
     * A roundKey is `<llmqType>:<height>:<index>`, so the colons are encoded
     * and the pattern takes the rest of the path in one piece. The server also
     * answers on a quorumHash, and this route carries either.
     */
    path: '/round',
    tag: 'dd-page-round',
    label: 'DKG Round',
    hidden: true,
    pattern: /^\/round\/(.+)$/,
    key: 'id',
    section: '/rounds',
  },
  {
    path: '/block',
    tag: 'dd-page-block',
    label: 'Block',
    hidden: true,
    pattern: /^\/block\/([^/]+)$/,
    key: 'id',
    section: '/blocks',
  },
  {
    path: '/tx',
    tag: 'dd-page-tx',
    label: 'Transaction',
    hidden: true,
    pattern: /^\/tx\/([^/]+)$/,
    key: 'txid',
    section: '/txs',
  },
];

export interface NavGroup {
  id: NavGroupId;
  label: string;
  /** The group's menu entries, in the order the menu shows them. */
  routes: Route[];
}

const GROUP_LABELS: ReadonlyArray<[NavGroupId, string]> = [
  ['overview', 'Overview'],
  ['network', 'Network'],
  ['blockchain', 'Blockchain'],
  ['experiments', 'Experiments'],
];

/**
 * The menu, grouped.
 *
 * Built from ROUTES rather than written out a second time, so a section added
 * there cannot be forgotten here: a visible route with no group would simply
 * never be reachable from the menu, and the unit test fails on exactly that.
 */
export const NAV_GROUPS: NavGroup[] = GROUP_LABELS.map(([id, label]) => ({
  id,
  label,
  routes: ROUTES.filter((route) => !route.hidden && route.group === id),
}));

/** Where a match sits in the menu. */
export interface NavLocation {
  group: NavGroup | null;
  /** The menu entry to light. */
  entry: Route | null;
  /**
   * True on the entry's own page, false on a detail page under it -- the
   * difference between `aria-current="page"` and "you are inside this".
   */
  exact: boolean;
}

export function navLocation(match: Match): NavLocation {
  const none: NavLocation = { group: null, entry: null, exact: false };
  // A page that could not be found is not inside any section, and lighting one
  // would say it was.
  if (match.status !== 'matched') return none;
  const route = match.route;
  const exact = !route.hidden;
  const entryPath = exact ? route.path : route.section;
  if (entryPath === undefined) return none;
  for (const group of NAV_GROUPS) {
    const entry = group.routes.find((candidate) => candidate.path === entryPath);
    if (entry) return { group, entry, exact };
  }
  return none;
}

export function matchRoute(pathname: string): Match {
  const clean = pathname.replace(/\/+$/, '') || '/';

  for (const route of ROUTES) {
    if (route.pattern) {
      const m = route.pattern.exec(clean);
      if (!m) continue;
      const param = decodeParam(m[1]!);
      // The shape was a detail route's, but the identifier is unreadable. That
      // is a broken link, not a missing page, and saying so is the difference
      // between "fix your link" and "this page is gone".
      if (param === null) {
        return { route: MALFORMED_ROUTE, param: null, status: 'malformed', path: pathname };
      }
      return { route, param, status: 'matched', path: pathname };
    } else if (route.path === clean) {
      return { route, param: null, status: 'matched', path: pathname };
    }
  }
  return { route: NOT_FOUND_ROUTE, param: null, status: 'not-found', path: pathname };
}

export function navigate(href: string): void {
  const url = new URL(href, location.origin);
  if (url.pathname === location.pathname && url.search === location.search) return;
  history.pushState(null, '', url.pathname + url.search);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * Intercept same-origin link clicks, including those inside shadow roots --
 * `event.target` would report the host element, so the composed path is what
 * actually finds the anchor.
 */
export function installLinkInterceptor(): void {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = event
      .composedPath()
      .find((el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement && !!el.href);
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;

    const url = new URL(anchor.href);
    if (url.origin !== location.origin) return;
    /*
     * `/admin` is a different shell, chosen by `main.ts` from the pathname at
     * load time. Intercepting a link to it would push the path without ever
     * loading that shell, and this router does not know the route -- so the
     * reader would get "page not found" for an address that works perfectly
     * well when typed. Let the browser navigate.
     */
    if (isSeparateShell(url.pathname)) return;

    event.preventDefault();
    navigate(url.pathname + url.search);
  });
}

/**
 * Paths served by their own shell rather than by this router.
 *
 * Kept beside the interceptor because that is the only place it matters, and
 * spelled the same way `main.ts` spells it -- with and without the trailing
 * slash, because a link may carry either.
 */
export function isSeparateShell(pathname: string): boolean {
  return pathname === '/admin' || pathname === '/admin/';
}

/** Where a round row points. The key contains colons; they must be encoded. */
export function roundHref(roundKey: string): string {
  return `/round/${encodeURIComponent(roundKey)}`;
}
