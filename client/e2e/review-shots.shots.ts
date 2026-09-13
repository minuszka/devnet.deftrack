import type { Page } from '@playwright/test';
import { expect, fail, ok, test, type ApiStubs } from './harness.js';
import { healthSnapshot } from './fixtures/api.js';
import { adminSessionStubs, labRegistry, RUN_A, runStubs } from './fixtures/admin.js';
import { emptyLayoutStubs, HASH, loadedLayoutStubs } from './fixtures/layout.js';
import { SIM_A, simReport, simRun } from './fixtures/simulations.js';

/**
 * The review screenshots. See playwright.shots.config.ts.
 *
 * Every picture is of synthetic fixture data -- no host address, no operator,
 * no credential -- which is what lets them be shared with a reviewer at all.
 */

const OUT = 'review-shots';

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  // A frame for the last render to land; the pictures are of what settled.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
}

function failing(message: string): ApiStubs {
  return {
    '/api/v1/health': { body: ok(healthSnapshot()) },
    '/api/v1/*': { status: 500, body: fail(message) },
  };
}

test.describe.configure({ timeout: 60_000 });

test('public pages, working and failing, desktop and phone', async ({ app, page }) => {
  app.stub(loadedLayoutStubs());
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto('/');
  await expect(page.locator('.page-title')).toHaveText('Overview');
  await page.waitForLoadState('networkidle');
  await shot(page, '01-overview-desktop');

  await page.setViewportSize({ width: 360, height: 780 });
  await shot(page, '02-overview-phone');
  await page.getByRole('button', { name: /Menu/ }).click();
  await shot(page, '03-menu-open-phone');

  await app.goto('/rounds');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.scrollTo(0, 560));
  await shot(page, '04-rounds-table-scroll-hint-phone');

  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto(`/search?q=${HASH}`);
  await expect(page.locator('dd-page-search .result').first()).toBeVisible();
  await shot(page, '05-search-several-matches-desktop');

  await app.goto('/methodology');
  await shot(page, '06-how-we-measure-desktop');
});

test('failing, empty, unchecked and not found', async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  app.stub(failing('upstream unavailable (fixture)'));
  for (const [path, name] of [
    ['/', '07-overview-failing'],
    ['/pose', '08-pose-failing'],
    ['/blocks', '09-blocks-failing'],
    ['/fairness', '10-fairness-chainlock-report-unreadable'],
  ] as const) {
    await app.goto(path);
    await page.waitForLoadState('networkidle');
    await shot(page, name);
  }
  await app.goto(`/search?q=${HASH}`);
  await expect(page.locator('dd-page-search .unchecked')).toBeVisible();
  await shot(page, '11-search-could-not-be-checked');

  for (const key of Object.keys(failing(''))) app.unstub(key);
  app.stub(emptyLayoutStubs());
  await app.goto('/pose');
  await page.waitForLoadState('networkidle');
  await shot(page, '12-pose-genuinely-empty');

  await app.goto('/no-such-page');
  await shot(page, '13-not-found');
});

test('a simulation result that must not read as a pass', async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  app.stub({
    '/api/v1/health': { body: ok(healthSnapshot()) },
    [`/api/v1/simulations/${SIM_A}`]: { body: ok(simRun({ live: false })) },
    [`/api/v1/simulations/${SIM_A}/report`]: { body: ok(simReport('matched')) },
  });
  await app.goto(`/simulations/${SIM_A}`);
  await expect(page.locator('.reading')).toBeVisible();
  await shot(page, '14-simulation-dry-run-matched', true);
});

test('admin: signed out, unavailable, working on a phone, action refused', async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  app.stub({ '/api/v1/admin/session': { status: 401, body: fail('no admin session') } });
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Admin access', exact: true })).toBeVisible();
  await shot(page, '15-admin-signed-out');

  app.stub({ '/api/v1/admin/session': { status: 500, body: fail('session store unavailable (fixture)') } });
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Admin access is unavailable', exact: true })).toBeVisible();
  await shot(page, '16-admin-session-unavailable');

  app.stub({
    ...adminSessionStubs({ targets: labRegistry() }),
    ...runStubs({ runKey: RUN_A, status: 'fault_active', live: true, faultMayBeActive: true }),
    [`/api/v1/admin/simulations/runs/${RUN_A}/abort`]: { status: 503, body: fail('the lab executor did not answer (fixture)') },
  });
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`/admin?run=${RUN_A}`);
  await page.getByRole('button', { name: 'Abort & recover' }).click();
  await expect(page.locator('dd-simulation-control .alert[role="alert"]').first()).toBeVisible();
  await page.locator('dd-simulation-control .alert[role="alert"]').first().scrollIntoViewIfNeeded();
  await shot(page, '17-admin-abort-refused-phone');
});
