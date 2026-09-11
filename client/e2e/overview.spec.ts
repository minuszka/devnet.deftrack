import { expect, fail, ok, test } from './harness.js';
import { healthTimeline, V2_PROFILE } from './fixtures/api.js';
import { overviewStubs } from './fixtures/stubs.js';

test.describe('public overview', () => {
  test('renders the chain the API reported, for one named profile', async ({ app, page }) => {
    app.stub(overviewStubs());
    await app.goto('/');

    // The shell's own header, fed by /health.
    await expect(page.getByText('11,500').first()).toBeVisible();
    await expect(page.locator('.page-title')).toHaveText('Overview');

    // The page must say which profile its figures are about. Before this
    // existed the front page blended five interleaved schedules into one
    // formation rate -- a number that looks like an answer without being one.
    await expect(page.locator('.page-sub').filter({ hasText: V2_PROFILE })).toBeVisible();

    // And it must have asked the server for that profile alone: the profile is
    // resolved from the ChainLock signers and the tip before the round figures
    // are fetched, so the second request carries it.
    const roundCalls = app.callsTo('/api/v1/quorum-rounds');
    expect(roundCalls.length).toBeGreaterThan(0);
    expect(roundCalls.every((call) => call.includes(`llmqName=${V2_PROFILE}`))).toBe(true);
  });

  test('shows a failed request instead of an empty page', async ({ app, page }) => {
    app.stub({
      ...overviewStubs(),
      '/api/v1/quorum-rounds/health-timeline': {
        status: 500,
        body: fail('the round index is unavailable'),
      },
    });
    await app.goto('/');

    const error = page.locator('.err[role="alert"]');
    await expect(error).toBeVisible();
    await expect(error).toContainText('the round index is unavailable');
  });

  test('a body that is not the envelope is reported by status, not rendered', async ({
    app,
    page,
  }) => {
    app.stub({
      ...overviewStubs(),
      '/api/v1/quorum-rounds/health-timeline': {
        status: 502,
        raw: '<html><body>gateway</body></html>',
        contentType: 'text/html',
      },
    });
    await app.goto('/');

    await expect(page.locator('.err[role="alert"]')).toContainText('502');
  });

  test('a profile that cannot be resolved shows no blended figure', async ({ app, page }) => {
    app.stub({
      ...overviewStubs(),
      // No ChainLock report: the signing profile is then undecidable, and the
      // page owes the reader that sentence rather than a number.
      '/api/v1/chainlocks': { status: 503, body: fail('chainlock report unavailable') },
      '/api/v1/quorum-rounds/health-timeline': { body: ok(healthTimeline()) },
    });
    await app.goto('/');

    await expect(page.locator('.note[role="status"]')).toContainText(
      'signing profile could not be determined'
    );
  });
});
