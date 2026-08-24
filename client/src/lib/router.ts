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

export interface Match {
  route: Route;
  param: string | null;
}

export const ROUTES: Route[] = [
  { path: '/', tag: 'dd-page-overview', label: 'Overview' },
  { path: '/rounds', tag: 'dd-page-rounds', label: 'DKG Rounds' },
  { path: '/pose', tag: 'dd-page-pose', label: 'PoSe Watch' },
  { path: '/masternodes', tag: 'dd-page-masternodes', label: 'Masternodes' },
  { path: '/chainlocks', tag: 'dd-page-chainlocks', label: 'ChainLocks' },
  { path: '/staking', tag: 'dd-page-staking', label: 'Staking' },
  { path: '/experiments', tag: 'dd-page-experiments', label: 'Experiments' },
  { path: '/blocks', tag: 'dd-page-blocks', label: 'Blocks' },
  { path: '/txs', tag: 'dd-page-txs', label: 'Transactions' },
  { path: '/operators', tag: 'dd-page-operators', label: 'Operators' },
  {
    path: '/experiments',
    tag: 'dd-page-experiments',
    label: 'Experiment',
    hidden: true,
    pattern: /^\/experiments\/([^/]+)$/,
    key: 'runKey',
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
      if (m) return { route, param: decodeURIComponent(m[1]!) };
    } else if (route.path === clean) {
      return { route, param: null };
    }
  }
  return { route: ROUTES[0]!, param: null };
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
