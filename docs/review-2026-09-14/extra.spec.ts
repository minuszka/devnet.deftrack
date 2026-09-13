import { test, expect, ok, fail } from '../../client/e2e/harness.js';
import { adminSessionStubs, runStubs, RUN_A, RUN_B } from '../../client/e2e/fixtures/admin.js';
import { overviewStubs } from '../../client/e2e/fixtures/stubs.js';
const A = `/api/v1/admin/simulations/runs/${RUN_A}`;
async function stopped(page: import('@playwright/test').Page) {
  await page.clock.install({ time: new Date('2026-09-14T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-14T00:00:01Z'));
}

for (const failed of ['history', 'dry-run']) {
  test(`X1 recovery 401 is not lost when the initial ${failed} read fails first`, async ({ app, page }) => {
    const late401 = app.gate();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    app.stub({ ...adminSessionStubs(), ...runStubs({ runKey: RUN_A, status: 'completed', revision: 9 }),
      [`${A}/${failed}`]: { status: 503, body: fail('initial companion read failed') },
      [`${A}/recovery`]: { status: 401, body: fail('session expired'), gate: late401 },
    });
    await stopped(page);
    await app.goto(`/admin?run=${RUN_A}`);
    await late401.waitForHeld();
    // The failed body has been read before the 401 is released. Do not require
    // a particular intermediate error UI: an all-settled fix may wait here.
    await app.waitUntilRead(`${A}/${failed}`, 1);
    await late401.release();
    expect(pageErrors).toEqual([]);
    await expect(page.getByRole('button', { name: 'Continue to admin dashboard' })).toBeVisible();
  });
}

test('C3 a late initial evidence 401 after selecting a planless B cannot end B session', async ({ app, page }) => {
  const late = app.gate();
  const waiting = app.gate();
  const B = `/api/v1/admin/simulations/runs/${RUN_B}`;
  app.stub({ ...adminSessionStubs(),
    ...runStubs({ runKey: RUN_A, status: 'fault_active', revision: 9, live: true, faultMayBeActive: true }),
    ...runStubs({ runKey: RUN_B, status: 'fault_active', revision: 10, live: true, faultMayBeActive: true }),
    [`${A}/recovery`]: { status: 401, body: fail('old selection session expired'), gate: late },
    [`${B}/dry-run`]: { status: 503, body: fail('B plan unavailable'), gate: waiting },
  });
  await stopped(page);
  await app.goto(`/admin?run=${RUN_A}`);
  await late.waitForHeld();
  await page.evaluate((key) => { history.pushState(null,'',`/admin?run=${key}`); window.dispatchEvent(new PopStateEvent('popstate')); }, RUN_B);
  await waiting.waitForHeld();
  await page.clock.fastForward(5000);
  await expect(page.locator('.run-state')).toContainText(RUN_B);
  await late.release();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abort & recover' })).toBeVisible();
});

test('C4 abandoning a held answer aborts it without giving its body to the page', async ({ app, page }) => {
  const gate = app.gate();
  app.stub({ ...overviewStubs(), '/api/v1/abandon-probe': { body: ok({ mustNotArrive: true }), gate } });
  await app.goto('/');
  await page.evaluate(() => {
    void fetch('/api/v1/abandon-probe').then(r => r.json()).then(
      () => { (window as any).abandonResult = 'body arrived'; },
      () => { (window as any).abandonResult = 'aborted'; },
    );
  });
  await gate.waitForHeld();
  app.abandonHeld();
  await expect.poll(() => page.evaluate(() => (window as any).abandonResult)).toBe('aborted');
  expect(gate.held).toEqual([]);
});
