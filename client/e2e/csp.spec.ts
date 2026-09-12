import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, ok, test } from './harness.js';
import { overviewStubs, roundStubs } from './fixtures/stubs.js';
import { adminSessionStubs, RUN_A, runStubs } from './fixtures/admin.js';
import { blockArrivalReport, chainLockReport, healthSnapshot, pageOf, roundRun, selectionFairness } from './fixtures/api.js';

/**
 * F10, the half a header check cannot answer.
 *
 * `ops/nginx/verify-headers.sh` proves the policy is *sent*, on every location
 * and on the 404. This proves it is *survivable*: the same policy text, read
 * from the file that ships it, applied by a real browser to the real build, on
 * the pages that matter.
 *
 * Two things make it evidence rather than decoration. It applies the ENFORCING
 * policy, not the report-only one -- under report-only a violation is logged
 * and the page carries on, so "no violations" and "the policy is inert" look
 * identical. And every page is asserted to have rendered, because a blank page
 * raises no violations either.
 *
 * The policy is read from ops/nginx/csp-enforce.conf rather than copied here.
 * A copy is a second source of truth, and this test exists precisely because
 * the deployed policy and the running app can disagree.
 */
const POLICY = (() => {
  const conf = readFileSync(
    fileURLToPath(new URL('../../ops/nginx/csp-enforce.conf', import.meta.url)),
    'utf8'
  );
  const match = conf.match(/^add_header Content-Security-Policy "(.*)" always;$/m);
  if (match === null) throw new Error('could not read the policy out of ops/nginx/csp-enforce.conf');
  return match[1]!;
})();

interface Violation {
  directive: string;
  blocked: string;
  sample: string;
}

/**
 * Apply the policy to the document, the way nginx will, and record what the
 * browser refuses.
 *
 * Registered inside the test so it takes precedence over the harness's own
 * catch-all, and falls back to it for everything that is not the document --
 * the modules, the stylesheet and the stubbed API all still go through the
 * harness, so this stays a loopback-only test.
 */
async function underPolicy(page: import('@playwright/test').Page): Promise<() => Promise<Violation[]>> {
  await page.addInitScript(() => {
    (window as unknown as { __csp: Violation[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { __csp: Violation[] }).__csp.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        sample: event.sample,
      });
    });
  });

  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': POLICY },
    });
  });

  return () => page.evaluate(() => (window as unknown as { __csp: Violation[] }).__csp);
}

test.describe('the shipped CSP, on the built client', () => {
  test('the public pages run under it with nothing refused', async ({ app, page }) => {
    const violations = await underPolicy(page);
    app.stub({
      ...overviewStubs(),
      ...roundStubs(),
      '/api/v1/chainlocks': { body: ok(chainLockReport()) },
      '/api/v1/block-arrival': { body: ok(blockArrivalReport()) },
      '/api/v1/health': { body: ok(healthSnapshot()) },
      '/api/v1/fairness/selection': { body: ok(selectionFairness()) },
      '/api/v1/quorum-rounds': { body: ok(pageOf(roundRun(5), { total: 120, limit: 50 })) },
    });

    // The overview and a filtered list: between them they draw the inline
    // `style=` attributes -- bar widths and flex shares -- that decided the
    // style-src-attr half of the policy.
    await app.goto('/');
    await expect(page.locator('.page-title')).toHaveText('Overview');
    expect(await violations(), 'on /').toEqual([]);

    await app.goto('/rounds');
    await expect(page.locator('dd-page-rounds')).toHaveCount(1);
    await expect(page.locator('table')).toBeVisible();
    expect(await violations(), 'on /rounds').toEqual([]);

    await app.goto('/chainlocks');
    await expect(page.locator('dd-page-chainlocks')).toHaveCount(1);
    expect(await violations(), 'on /chainlocks').toEqual([]);
  });

  /**
   * The admin shell is a separate entry point and a separate chunk, so it is a
   * separate dynamic import -- the one the policy's `script-src 'self'` has to
   * admit without an inline script or a nonce.
   */
  test('the admin shell loads its own chunk under it', async ({ app, page }) => {
    const violations = await underPolicy(page);
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'fault_active', live: true, faultMayBeActive: true }),
    });

    await app.goto(`/admin?run=${RUN_A}`);
    await expect(page.locator('.run-state')).toBeVisible();
    // A rendered control panel means the chunk loaded, which is the point.
    await expect(page.getByRole('button', { name: 'Abort & recover' })).toBeVisible();
    expect(await violations(), 'on /admin').toEqual([]);
  });

  /**
   * The control that keeps the other two honest.
   *
   * If the policy were inert -- a typo in the header name, a directive the
   * browser ignores, a route that never applied it -- every assertion above
   * would pass while measuring nothing. This asks the page to do something the
   * policy forbids and requires the browser to refuse it.
   */
  test('the policy is actually in force', async ({ app, page }) => {
    const violations = await underPolicy(page);
    app.stub(overviewStubs());
    await app.goto('/');
    await expect(page.locator('.page-title')).toHaveText('Overview');
    expect(await violations()).toEqual([]);

    // `script-src 'self'` with no 'unsafe-inline': an injected inline script
    // must not run, and must be reported.
    await page.evaluate(() => {
      const el = document.createElement('script');
      el.textContent = 'window.__cspEscaped = true;';
      document.head.append(el);
    });

    await expect.poll(async () => (await violations()).length).toBeGreaterThan(0);
    const refused = await violations();
    expect(refused.some((v) => v.directive.startsWith('script-src'))).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { __cspEscaped?: boolean }).__cspEscaped)).toBeUndefined();
  });
});
