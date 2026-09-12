import { expect, ok, test } from './harness.js';
import { healthSnapshot } from './fixtures/api.js';
import { overviewStubs } from './fixtures/stubs.js';

/**
 * The harness testing itself.
 *
 * A verification tool must be shown to fail on data it should reject before its
 * passes are worth anything -- this project has already paid for that lesson
 * once, with a repair tool whose failures were believed for a day and whose bug
 * was in the tool. These two tests are the negative controls for the two ways a
 * browser suite silently stops testing anything: an endpoint that escapes to a
 * real server, and a request that leaves the machine.
 */
test.describe('harness guards', () => {
  test('an API call with no stub is refused and recorded', async ({ app }) => {
    app.expectViolations();
    // Only /health is answered. The overview also needs the ChainLock report,
    // the round list and the timeline; each of those must be refused.
    app.stub({ '/api/v1/health': { body: ok(healthSnapshot()) } });
    await app.goto('/');

    await expect
      .poll(() => app.violations.length, { message: 'refusals recorded' })
      .toBeGreaterThan(0);
    expect(app.violations.some((v) => v.includes('/api/v1/chainlocks'))).toBe(true);
    expect(app.violations.every((v) => v.startsWith('unstubbed API request:'))).toBe(true);
  });

  test('a request that leaves the machine is refused and recorded', async ({ app, page }) => {
    app.expectViolations();
    app.stub(overviewStubs());
    await app.goto('/');
    await page.evaluate(() => fetch('https://example.invalid/probe').catch(() => null));

    await expect.poll(() => app.violations).toEqual([
      expect.stringContaining('external request refused:'),
    ]);
  });
});
