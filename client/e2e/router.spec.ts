import { expect, fail, test } from './harness.js';
import { overviewStubs, roundStubs, shellStubs } from './fixtures/stubs.js';

/**
 * F07 and F08: what the site does with a URL it cannot serve.
 *
 * Both were silent in their own way. A malformed percent-escape threw a
 * `URIError` out of `matchRoute`, which the shell calls while constructing
 * itself -- so the custom element never upgraded and the page was blank, with
 * nothing on screen saying why. An unknown path quietly rendered the overview,
 * so a stale or mistyped link looked like a working link to the front page.
 *
 * The contract these tests fix in place: the shell always renders, the URL is
 * never rewritten behind the reader's back, and the page says which of the two
 * happened.
 */
test.describe('router', () => {
  /**
   * Reached the way the running application can actually reach it.
   *
   * A document load at one of these paths never gets as far as the client: the
   * dev server answers 404 for every path whose escapes `decodeURIComponent`
   * would reject (measured: `/round/%`, `/round/%ff`, `/tx/%E0%A4%A` all 404,
   * while the well-formed `/tx/%E0%A4%AF` is served). What production's nginx
   * does with such a request is not settled here and belongs with the header
   * work in `ops/nginx/`. Inside the SPA the path is reachable, and that is
   * where the defect lived: `matchRoute` threw out of the popstate handler, so
   * the address bar said `/round/%` while the overview stayed on screen.
   */
  async function navigateInApp(page: import('@playwright/test').Page, path: string): Promise<void> {
    await page.evaluate((target) => {
      history.pushState(null, '', target);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, path);
  }

  test('a malformed escape renders an explanation, not the wrong page', async ({ app, page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    app.stub(overviewStubs());
    await app.goto('/');
    await expect(page.locator('.page-title')).toHaveText('Overview');

    await navigateInApp(page, '/round/%');

    await expect(page.locator('.page-title')).toHaveText('That link could not be read');
    // The URL stays as it was; rewriting it loses the evidence of what broke.
    expect(new URL(page.url()).pathname).toBe('/round/%');
    await expect(page.locator('code').filter({ hasText: '/round/%' })).toBeVisible();
    // Before the fix this list held "URI malformed" and the overview was still
    // on screen under a round URL.
    expect(pageErrors).toEqual([]);
  });

  test('a truncated multi-byte escape is handled the same way', async ({ app, page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    app.stub(overviewStubs());
    await app.goto('/');
    await navigateInApp(page, '/tx/%E0%A4%A');

    await expect(page.locator('.page-title')).toHaveText('That link could not be read');
    expect(new URL(page.url()).pathname).toBe('/tx/%E0%A4%A');
    expect(pageErrors).toEqual([]);
  });

  test('a well-formed escape the server does serve still reaches its page', async ({
    app,
    page,
  }) => {
    // A 404 from the API is the honest answer here -- no such transaction was
    // invented. What is under test is which page the router chose.
    app.stub({ ...shellStubs(), '/api/v1/txs/*': { status: 404, body: fail('no such transaction') } });
    // Valid UTF-8, so both the server and decodeURIComponent accept it: it must
    // resolve to the transaction page, not to the broken-link page.
    await app.goto('/tx/%E0%A4%AF');

    await expect(page.locator('dd-page-tx')).toHaveCount(1);
    await expect(page.locator('dd-page-not-found')).toHaveCount(0);
  });

  test('an unknown path says so instead of showing the overview', async ({ app, page }) => {
    app.stub(shellStubs());
    await app.goto('/audit-nonexistent-20260911');

    await expect(page.locator('.page-title')).toHaveText('Page not found');
    expect(new URL(page.url()).pathname).toBe('/audit-nonexistent-20260911');
    // The overview must not be what an unknown path renders.
    await expect(page.locator('dd-page-overview')).toHaveCount(0);
  });

  test('the error page offers a way back, and it works', async ({ app, page }) => {
    app.stub({ ...shellStubs(), ...overviewStubs() });
    await app.goto('/audit-nonexistent-20260911');

    await page.locator('main').getByRole('link', { name: 'Go to the overview' }).click();
    await expect(page.locator('.page-title')).toHaveText('Overview');
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('an encoded round key still reaches the round page', async ({ app, page }) => {
    app.stub(roundStubs());
    await app.goto('/round/7%3A7416%3A0');

    await expect(page.locator('dd-page-round')).toHaveCount(1);
    await expect(page.locator('dd-page-not-found')).toHaveCount(0);
    // The key is decoded once, and reaches the API re-encoded exactly as sent.
    expect(app.callsTo('/api/v1/quorum-rounds/7%3A7416%3A0').length).toBeGreaterThan(0);
  });

  test('the round list is not swallowed by the round detail route', async ({ app, page }) => {
    app.stub(roundStubs());
    await app.goto('/rounds');
    await expect(page.locator('dd-page-rounds')).toHaveCount(1);

    // And a trailing slash is the same page, not a miss.
    await app.goto('/rounds/');
    await expect(page.locator('dd-page-rounds')).toHaveCount(1);
  });

  test('back and forward restore the pages they left', async ({ app, page }) => {
    app.stub({ ...overviewStubs(), ...roundStubs() });
    await app.goto('/');
    await expect(page.locator('.page-title')).toHaveText('Overview');

    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'DKG Rounds' }).click();
    await expect(page.locator('dd-page-rounds')).toHaveCount(1);
    expect(new URL(page.url()).pathname).toBe('/rounds');

    await page.goBack();
    await expect(page.locator('dd-page-overview')).toHaveCount(1);

    await page.goForward();
    await expect(page.locator('dd-page-rounds')).toHaveCount(1);
  });
});
