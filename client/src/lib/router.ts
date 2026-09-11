/**
 * Minimal history router.
 *
 * Deliberately not lazy-loading page modules the way SCAN does: the whole
 * bundle is well under 100 kB, so a second network round trip per navigation
 * would cost more than it saves.
 */

export interface Route {
  path: string;
  tag: string;
  label: string;
  /** Routable but absent from the menu -- detail pages are reached by link. */
  hidden?: boolean;
  /** One `:name` segment, matched against the path. */
  pattern?: RegExp;
  key?: string;
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
  { path: '/', tag: 'dd-page-overview', label: 'Overview' },
  { path: '/rounds', tag: 'dd-page-rounds', label: 'DKG Rounds' },
  { path: '/pose', tag: 'dd-page-pose', label: 'PoSe Watch' },
  { path: '/masternodes', tag: 'dd-page-masternodes', label: 'Masternodes' },
  { path: '/chainlocks', tag: 'dd-page-chainlocks', label: 'ChainLocks' },
  { path: '/dsl', tag: 'dd-page-dsl', label: 'Sentinel Layer' },
  { path: '/staking', tag: 'dd-page-staking', label: 'Staking' },
  { path: '/peers', tag: 'dd-page-peers', label: 'Vantage Points' },
  { path: '/experiments', tag: 'dd-page-experiments', label: 'Experiments' },
  { path: '/blocks', tag: 'dd-page-blocks', label: 'Blocks' },
  { path: '/txs', tag: 'dd-page-txs', label: 'Transactions' },
  { path: '/operators', tag: 'dd-page-operators', label: 'Operators' },
  { path: '/fairness', tag: 'dd-page-fairness', label: 'Fairness' },
  {
    path: '/experiments',
    tag: 'dd-page-experiments',
    label: 'Experiment',
    hidden: true,
    pattern: /^\/experiments\/([^/]+)$/,
    key: 'runKey',
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
  },
  {
    path: '/block',
    tag: 'dd-page-block',
    label: 'Block',
    hidden: true,
    pattern: /^\/block\/([^/]+)$/,
    key: 'id',
  },
  {
    path: '/tx',
    tag: 'dd-page-tx',
    label: 'Transaction',
    hidden: true,
    pattern: /^\/tx\/([^/]+)$/,
    key: 'txid',
  },
];

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

    event.preventDefault();
    navigate(url.pathname + url.search);
  });
}

/** Where a round row points. The key contains colons; they must be encoded. */
export function roundHref(roundKey: string): string {
  return `/round/${encodeURIComponent(roundKey)}`;
}
