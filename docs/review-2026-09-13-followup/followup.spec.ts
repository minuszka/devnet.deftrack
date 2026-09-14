import { test, expect, ok, fail } from '../../client/e2e/harness.js';
import { shellStubs, overviewStubs } from '../../client/e2e/fixtures/stubs.js';
import { simRuns } from '../../client/e2e/fixtures/simulations.js';
import { adminSessionStubs, runStubs, RUN_A, RUN_B, controlRun } from '../../client/e2e/fixtures/admin.js';
import { ACTIVATION_HEIGHT, chainLockReport, healthSnapshot, llmqProfile, selectionFairness, V1_PROFILE, V2_PROFILE } from '../../client/e2e/fixtures/api.js';

const A = `/api/v1/admin/simulations/runs/${RUN_A}`;
const B = `/api/v1/admin/simulations/runs/${RUN_B}`;
async function stopClock(page: import('@playwright/test').Page) {
  await page.clock.install({ time: new Date('2026-09-13T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-13T12:00:01Z'));
}

test('W1 simulations retains the last good list on a same-query poll failure', async ({ app, page }) => {
  app.stub({ ...shellStubs(), '/api/v1/simulations': { body: ok({ items: simRuns(3), total: 3, limit: 25, offset: 0 }) } });
  await stopClock(page);
  await app.goto('/simulations');
  const row = page.locator('dd-page-simulations tbody a').first();
  await expect(row).toBeVisible();
  app.stub({ '/api/v1/simulations': { status: 503, body: fail('same query refresh failed') } });
  await page.clock.fastForward(30000);
  await expect(page.locator('dd-page-simulations .err')).toContainText('same query refresh failed');
  await expect(row).toBeVisible();
});

test('W2 a recovery 401 expires the session rather than becoming an evidence outage', async ({ app, page }) => {
  app.stub({ ...adminSessionStubs(), ...runStubs({ runKey: RUN_A, status: 'completed', revision: 9 }),
    [`${A}/recovery`]: { status: 401, body: fail('session expired') } });
  await stopClock(page);
  await app.goto(`/admin?run=${RUN_A}`);
  await app.waitUntilRead(`${A}/recovery`, 1);
  await expect(page.getByRole('button', { name: 'Continue to admin dashboard' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
});

test('W3 gate release must observe its own response, not another read of the same URL', async ({ app, page }) => {
  const gate = app.gate();
  const path = '/api/v1/review-read-identity';
  app.stub({ ...overviewStubs(), [path]: { body: ok({ n: 1 }), gate } });
  await app.goto('/');
  await page.evaluate((path) => {
    const w = window as any;
    w.reviewReadAllowed = new Promise<void>((resolve) => { w.allowReviewRead = resolve; });
    void fetch(path).then(async (r) => {
      w.reviewResponseArrived = true;
      await w.reviewReadAllowed;
      w.reviewFirstBody = await r.json();
    });
  }, path);
  await gate.waitForHeld();
  const released = gate.release();
  await expect.poll(() => page.evaluate(() => (window as any).reviewResponseArrived)).toBe(true);
  app.stub({ [path]: { body: ok({ n: 2 }) } });
  await page.evaluate(async (path) => { await (await fetch(path)).json(); }, path);
  // Deliberately defer THIS body's read, as the harness's own 300 ms self-test
  // does. This is the injected condition, not a sleep after an assertion.
  // A correct release waits for this read and then the final assertion passes.
  const allowFirstRead = new Promise<void>((resolve, reject) => {
    setTimeout(() => { page.evaluate(() => (window as any).allowReviewRead()).then(resolve, reject); }, 750);
  });
  await released;
  const firstBody = await page.evaluate(() => (window as any).reviewFirstBody);
  await allowFirstRead;
  expect(firstBody).toEqual(ok({ n: 1 }));
});

test('C2 switching away from a planless run never sends its abort under the new selection', async ({ app, page }) => {
  const oldPlan = app.gate();
  const newPlan = app.gate();
  app.stub({ ...adminSessionStubs(),
    ...runStubs({ runKey: RUN_A, status: 'fault_active', revision: 9, live: true, faultMayBeActive: true }),
    ...runStubs({ runKey: RUN_B, status: 'fault_active', revision: 11, live: true, faultMayBeActive: true }),
    [`${A}/dry-run`]: { status: 503, body: fail('old plan unavailable'), gate: oldPlan },
    [`${B}/dry-run`]: { status: 503, body: fail('new plan unavailable'), gate: newPlan },
    [`${B}/abort`]: { body: ok({ run: controlRun({ runKey: RUN_B, status: 'aborting', revision: 12, live: true, faultMayBeActive: true }) }) },
  });
  await stopClock(page);
  await app.goto(`/admin?run=${RUN_A}`);
  await oldPlan.waitForHeld();
  await page.clock.fastForward(5000);
  await expect(page.locator('.run-state')).toContainText(RUN_A);
  await page.evaluate((run) => { history.pushState(null, '', `/admin?run=${run}`); window.dispatchEvent(new PopStateEvent('popstate')); }, RUN_B);
  await newPlan.waitForHeld();
  await expect(page.getByRole('button', { name: 'Abort & recover' })).toHaveCount(0);
  await page.clock.fastForward(5000);
  await expect(page.locator('.run-state')).toContainText(RUN_B);
  await oldPlan.release();
  await expect(page.locator('.run-state')).toContainText(RUN_B);
  await page.getByRole('button', { name: 'Abort & recover' }).click();
  await expect(page.locator('.run-state')).toContainText('aborting');
  expect(app.requestsTo(`${A}/abort`, 'POST')).toHaveLength(0);
  expect(app.requestsTo(`${B}/abort`, 'POST')).toHaveLength(1);
});

test('W4 automatic Fairness profile change does not keep the old profile under the new selection', async ({ app, page }) => {
  const endpoint = '/api/v1/fairness/selection';
  app.stub({ ...shellStubs(),
    '/api/v1/health': { body: ok(healthSnapshot({ chainTip: ACTIVATION_HEIGHT - 1 })) },
    '/api/v1/chainlocks': { body: ok(chainLockReport()) },
    '/api/v1/quorum-rounds/profiles': { body: ok({ items: [llmqProfile(), llmqProfile({ llmqName: V1_PROFILE, llmqType: 4 })] }) },
    [endpoint]: (url) => ({ body: ok(selectionFairness({ llmqName: url.searchParams.get('llmqName') })) }),
  });
  await stopClock(page);
  await app.goto('/fairness');
  await expect(page.locator('.tiles')).toContainText(V1_PROFILE);
  app.stub({ '/api/v1/health': { body: ok(healthSnapshot({ chainTip: ACTIVATION_HEIGHT + 1 })) },
    [endpoint]: { status: 503, body: fail('new profile unavailable') } });
  await page.clock.fastForward(60000);
  await expect(page.locator('.err')).toContainText('new profile unavailable');
  await expect(page.getByRole('button', { name: `${V2_PROFILE} · at the tip` })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tiles')).toHaveCount(0);
});
