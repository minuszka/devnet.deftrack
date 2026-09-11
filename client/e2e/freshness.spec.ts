import { expect, fail, ok, test } from './harness.js';
import { healthSnapshot } from './fixtures/api.js';
import { overviewStubs } from './fixtures/stubs.js';

/**
 * F03: the header kept showing old counters as if they were current.
 *
 * A failed health poll was swallowed on purpose, so the numbers stayed on
 * screen with a breathing green dot beside them for as long as the endpoint
 * stayed down, and the overview said "live - refreshes every 30 s" whatever had
 * happened. The two questions -- is this data current, and is the network
 * healthy -- are different, and the page answered only the second.
 *
 * The clock is controlled here rather than waited on: staleness is defined in
 * poll periods, and a test that really waited sixty seconds for it would be
 * both slow and a guess.
 */
const START = new Date('2026-09-11T09:00:00.000Z');
const HEADER = '.datastate .freshness';

test.describe('data freshness', () => {
  test('a working page says how old its data is, not just that it is live', async ({
    app,
    page,
  }) => {
    await page.clock.install({ time: START });
    app.stub(overviewStubs());
    await app.goto('/');

    await expect(page.locator(HEADER)).toContainText('live · updated 0s ago');
    await expect(page.locator(HEADER)).toContainText('every 30 s');
    // The overview makes the same claim about its own figures.
    await expect(page.locator('.refresh')).toContainText('live · updated');
  });

  test('a failed refresh is visible at once, and the last good data stays', async ({
    app,
    page,
  }) => {
    await page.clock.install({ time: START });
    app.stub(overviewStubs());
    await app.goto('/');
    await expect(page.locator(HEADER)).toContainText('live · updated');

    // The endpoint goes away. The counters must survive; the claim must not.
    app.stub({ '/api/v1/health': { status: 503, body: fail('health endpoint unavailable') } });
    await page.clock.fastForward(30_000);

    await expect(page.locator(HEADER)).toContainText('refresh failed');
    await expect(page.locator('.datastate .why')).toContainText('health endpoint unavailable');
    await expect(page.getByRole('button', { name: 'Retry' }).first()).toBeVisible();
    // Still there, and still the same numbers -- that is the point of keeping them.
    await expect(page.locator('.monitor')).toContainText('152');
  });

  test('a recovery clears the failure without anything having to reset a flag', async ({
    app,
    page,
  }) => {
    await page.clock.install({ time: START });
    app.stub(overviewStubs());
    await app.goto('/');
    // Wait for the first success before taking the endpoint away, or the page
    // never has any data to keep and the state is `unavailable`, not `failing`.
    await expect(page.locator(HEADER)).toContainText('live · updated');

    app.stub({ '/api/v1/health': { status: 503, body: fail('gone') } });
    await page.clock.fastForward(30_000);
    await expect(page.locator(HEADER)).toContainText('refresh failed');

    app.stub({ '/api/v1/health': { body: ok(healthSnapshot()) } });
    await page.getByRole('button', { name: 'Retry' }).first().click();

    await expect(page.locator(HEADER)).toContainText('live · updated');
    await expect(page.locator('.datastate .why')).toHaveCount(0);
  });

  /**
   * The tab-hidden path, which is also the one that makes staleness reachable
   * without any failure at all: the poll controller stops the clock on a hidden
   * tab, so the data simply ages. Coming back must not show the old numbers as
   * current for even a moment longer than it takes to refresh them.
   */
  test('data that ages past two periods is marked stale, then refreshed on return', async ({
    app,
    page,
  }) => {
    await page.clock.install({ time: START });
    app.stub(overviewStubs());
    await app.goto('/');
    await expect(page.locator(HEADER)).toContainText('live · updated');

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.fastForward(90_000);

    await expect(page.locator(HEADER)).toContainText('stale · last update');
    // Stale is not a failure: no error line, no retry button.
    await expect(page.locator('.datastate .why')).toHaveCount(0);

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await expect(page.locator(HEADER)).toContainText('live · updated 0s ago');
  });

  test('the first request failing leaves a retry, not an endless skeleton', async ({
    app,
    page,
  }) => {
    await page.clock.install({ time: START });
    app.stub({
      ...overviewStubs(),
      '/api/v1/health': { status: 500, body: fail('health endpoint unavailable') },
    });
    await app.goto('/');

    await expect(page.locator(HEADER)).toContainText('no data — retry');
    await expect(page.getByRole('button', { name: 'Retry' }).first()).toBeVisible();
    // The skeleton is a loading state, and this is not loading any more.
    await expect(page.locator('.topbar .skeleton')).toHaveCount(0);

    app.stub({ '/api/v1/health': { body: ok(healthSnapshot()) } });
    await page.getByRole('button', { name: 'Retry' }).first().click();
    await expect(page.locator('.monitor')).toContainText('152');
  });

  /**
   * The health endpoint answers 503 with `success: true` when the network is
   * degraded: the request worked and the data is real. Judging it by
   * `response.ok` would throw away a correct description of a network in
   * trouble -- exactly when it is most worth reading.
   */
  test('a 503 that carries real data is data, not a failed request', async ({ app, page }) => {
    await page.clock.install({ time: START });
    app.stub({
      ...overviewStubs(),
      '/api/v1/health': {
        status: 503,
        body: ok(healthSnapshot({ status: 'degraded', failing: ['sync'], behind: 42 })),
      },
    });
    await app.goto('/');

    await expect(page.locator(HEADER)).toContainText('live · updated');
    await expect(page.locator('.monitor')).toContainText('degraded: sync');
    await expect(page.locator('.telemetry')).toContainText('42');
  });

  /**
   * Every figure whose source failed comes back as -1. The header printed them:
   * "mn -1", "staking -1", a round tally computed by adding four of them
   * together.
   */
  test('the API failure sentinel is not printed as a count', async ({ app, page }) => {
    await page.clock.install({ time: START });
    app.stub({
      ...overviewStubs(),
      '/api/v1/health': {
        body: ok(
          healthSnapshot({
            chainTip: -1,
            indexedHeight: -1,
            behind: -1,
            masternodes: { total: -1, enabled: -1 },
            stakers: { active: -1, windowBlocks: 500 },
            rounds: { formed: -1, failed: 12, pending: 1, impossible: 0 },
          })
        ),
      },
    });
    await app.goto('/');

    await expect(page.locator('.monitor')).toBeVisible();
    await expect(page.locator('.monitor')).not.toContainText('-1');
    await expect(page.locator('.telemetry')).not.toContainText('-1');
    // Hiding the lag chip would have claimed "not behind"; it says what it knows.
    await expect(page.locator('.telemetry .lag')).toContainText('unknown');
  });
});
