/**
 * Minimal history router.
 *
 * Deliberately not lazy-loading page modules the way SCAN does: the whole
 * bundle is under 40 kB, so a second network round trip per navigation would
 * cost more than it saves.
 */

export interface Route {
  path: string;
  tag: string;
  label: string;
  /** Hidden from the menu but still routable. */
  hidden?: boolean;
}

export const ROUTES: Route[] = [
  { path: '/', tag: 'dd-page-overview', label: 'Overview' },
  { path: '/rounds', tag: 'dd-page-rounds', label: 'DKG Rounds' },
  { path: '/pose', tag: 'dd-page-pose', label: 'PoSe Watch' },
  { path: '/masternodes', tag: 'dd-page-masternodes', label: 'Masternodes' },
  { path: '/operators', tag: 'dd-page-operators', label: 'Operators' },
];

export function matchRoute(pathname: string): Route {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return ROUTES.find((r) => r.path === clean) ?? ROUTES[0]!;
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
