import { expect, fail, ok, test } from './harness.js';
import { experimentRow, healthTimeline, pageOf, V2_PROFILE } from './fixtures/api.js';
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

  /*
   * Day 18: the top of the front page says whether an experiment is running --
   * all three answers, in words. A failure to read the list used to hide the
   * line, and a hidden line was also what "nothing running" looked like.
   */
  test.describe('the experiment line at the top', () => {
    async function aboveTheTiles(page: import('@playwright/test').Page, line: import('@playwright/test').Locator): Promise<void> {
      const lineBox = await line.boundingBox();
      const tilesBox = await page.locator('dd-page-overview .tiles').first().boundingBox();
      expect(lineBox && tilesBox && lineBox.y < tilesBox.y).toBe(true);
    }

    test('says when no experiment is running, rather than saying nothing', async ({ app, page }) => {
      app.stub(overviewStubs());
      await app.goto('/');
      const line = page.locator('dd-page-overview .strip').filter({ hasText: 'Experiments' });
      await expect(line).toContainText('No experiment is running.');
      await aboveTheTiles(page, line);
    });

    test('keeps "could not ask" apart from "nothing is running"', async ({ app, page }) => {
      app.stub({
        ...overviewStubs(),
        '/api/v1/experiments': { status: 503, body: fail('experiment index unavailable') },
      });
      await app.goto('/');
      const line = page.locator('dd-page-overview .strip').filter({ hasText: 'Experiments' });
      await expect(line).toContainText('could not be read');
      await expect(line).toContainText('experiment index unavailable');
      await expect(line).not.toContainText('No experiment is running');
      // One unreadable list is not a broken page: the rest still renders.
      await expect(page.locator('dd-page-overview .err')).toHaveCount(0);
      await aboveTheTiles(page, line);
    });

    test('names a running experiment', async ({ app, page }) => {
      app.stub({
        ...overviewStubs(),
        '/api/v1/experiments': {
          body: ok(pageOf([experimentRow({ runKey: 'fixture-run-0002', title: 'Fixture outage run', status: 'running', endedAt: null, endHeight: null })])),
        },
      });
      await app.goto('/');
      const line = page.locator('dd-page-overview .strip.task');
      await expect(line).toContainText('Fixture outage run');
      await expect(page.getByText('No experiment is running.')).toHaveCount(0);
      await aboveTheTiles(page, line);
    });
  });
});
