// Review counterexamples: desired behavior. R tests fail on main 83b8710;
// C1 is a passing control, not a reported defect.
// All API traffic is intercepted by the existing loopback-only test harness.
import { test, expect, ok, fail } from '../../client/e2e/harness.js';
import { adminSessionStubs, runStubs, controlRun, savedPlan, RUN_A, RUN_B } from '../../client/e2e/fixtures/admin.js';
import { roundStubs, shellStubs } from '../../client/e2e/fixtures/stubs.js';
import { pageOf, experimentRow, healthSnapshot, chainLockReport, llmqProfile, selectionFairness, V1_PROFILE, V2_PROFILE, ACTIVATION_HEIGHT } from '../../client/e2e/fixtures/api.js';
import { selectionFairness as computeFairness } from '../../server/src/domain/selectionFairness.js';

const base = (key: string) => `/api/v1/admin/simulations/runs/${key}`;
async function select(page: import('@playwright/test').Page, key: string) {
  await page.evaluate(key => {
    history.pushState(null, '', `/admin?run=${key}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, key);
}

test('R1 selecting B cannot leave an actionable Abort for A during hydration', async ({ app, page }) => {
  app.stub({
    ...adminSessionStubs(),
    ...runStubs({ runKey: RUN_A, status: 'fault_active', faultMayBeActive: true }),
    ...runStubs({ runKey: RUN_B }),
    [`${base(RUN_B)}/dry-run`]: { body: ok({ run: controlRun({ runKey: RUN_B }), plan: savedPlan(RUN_B) }), delayMs: 1800 },
    [`${base(RUN_A)}/abort`]: { body: ok({ run: controlRun({ runKey: RUN_A, status: 'cooldown', revision: 4 }) }) },
  });
  await app.goto(`/admin?run=${RUN_A}`);
  await expect(page.locator('.run-state')).toContainText(RUN_A);
  await select(page, RUN_B);
  await expect.poll(() => app.callsTo(`${base(RUN_B)}/dry-run`).length).toBe(1);
  // If stale controls are exposed, record the real request they would send.
  const oldAbort = page.getByRole('button', { name: 'Abort & recover' });
  if (await oldAbort.count() && await oldAbort.isEnabled()) await oldAbort.click();
  expect(app.requestsTo(`${base(RUN_A)}/abort`, 'POST')).toHaveLength(0);
});

test('R2 late A failure cannot erase already loaded B', async ({ app, page }) => {
  app.stub({
    ...adminSessionStubs(),
    ...runStubs({ runKey: RUN_A }),
    ...runStubs({ runKey: RUN_B }),
    [`${base(RUN_A)}/dry-run`]: { status: 503, body: fail('late A failure'), delayMs: 1200 },
  });
  await app.goto(`/admin?run=${RUN_A}`);
  await expect.poll(() => app.callsTo(`${base(RUN_A)}/dry-run`).length).toBe(1);
  await select(page, RUN_B);
  await expect(page.locator('.run-state')).toContainText(RUN_B);
  await page.waitForTimeout(1600);
  expect(new URL(page.url()).searchParams.get('run')).toBe(RUN_B);
  await expect(page.locator('.run-state')).toContainText(RUN_B);
});

test('R3 status transition refreshes recovery evidence', async ({ app, page }) => {
  await page.clock.install({ time: new Date('2026-09-11T09:00:00Z') });
  app.stub({ ...adminSessionStubs(), ...runStubs({ runKey: RUN_A, status: 'fault_active', faultMayBeActive: true }) });
  await app.goto(`/admin?run=${RUN_A}`);
  await expect(page.locator('.run-state')).toContainText('fault_active');
  await expect(page.locator('.approval')).toContainText('No recovery proof');
  app.stub(runStubs({ runKey: RUN_A, status: 'cooldown', revision: 9, recovery: {
    required: true, allClear: true, targets: [{ targetId: 'lab-mn-1', faultStateClear: true, expectedServiceRunning: true, observerFresh: true, checkedAtMs: 2000 }],
  } }));
  await page.clock.fastForward(5000);
  await expect(page.locator('.run-state')).toContainText('cooldown');
  await expect(page.locator('.approval')).toContainText('all targets clear');
});

test('R4 start acknowledgment belongs to the selected run', async ({ app, page }) => {
  app.stub({ ...adminSessionStubs(), ...runStubs({ runKey: RUN_A }), ...runStubs({ runKey: RUN_B }) });
  await app.goto(`/admin?run=${RUN_A}`);
  await expect(page.locator('.run-state')).toContainText(RUN_A);
  await page.getByRole('checkbox', { name: /I confirm/ }).check();
  await expect(page.getByRole('button', { name: 'Confirm and start', exact: true })).toBeEnabled();
  await select(page, RUN_B);
  await expect(page.locator('.run-state')).toContainText(RUN_B);
  await expect(page.getByRole('button', { name: 'Confirm and start', exact: true })).toBeDisabled();
});

test('C1 Back across routes preserves the destination status filter', async ({ app, page }) => {
  app.stub({ ...roundStubs(), '/api/v1/experiments': { body: ok(pageOf([experimentRow({status: 'closed'})])) } });
  await app.goto('/experiments?status=closed');
  await expect(page.locator('dd-page-experiments')).toHaveCount(1);
  await page.getByRole('link', { name: 'DKG Rounds', exact: true }).click();
  await expect(page.locator('dd-page-rounds')).toHaveCount(1);
  await page.goBack();
  await expect(page.locator('dd-page-experiments')).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get('status')).toBe('closed');
});

test('R5a implicit fairness profile follows a moving chain tip', async ({ app, page }) => {
  await page.clock.install({ time: new Date('2026-09-11T09:00:00Z') });
  app.stub({
    ...shellStubs(),
    '/api/v1/health': { body: ok(healthSnapshot({ chainTip: ACTIVATION_HEIGHT - 1 })) },
    '/api/v1/chainlocks': { body: ok(chainLockReport()) },
    '/api/v1/quorum-rounds/profiles': { body: ok({ items: [llmqProfile(), llmqProfile({ llmqName: V1_PROFILE, llmqType: 4 })] }) },
    '/api/v1/fairness/selection': url => ({ body: ok(selectionFairness({ llmqName: url.searchParams.get('llmqName') })) }),
  });
  await app.goto('/fairness');
  await expect(page.locator('.tiles')).toContainText(V1_PROFILE);
  app.stub({ '/api/v1/health': { body: ok(healthSnapshot({ chainTip: ACTIVATION_HEIGHT + 1 })) } });
  await page.clock.fastForward(60000);
  await expect.poll(() => app.callsTo('/api/v1/fairness/selection').length).toBeGreaterThan(1);
  expect(app.callsTo('/api/v1/fairness/selection').at(-1)).toContain(`llmqName=${V2_PROFILE}`);
});

test('R6 current registry size includes registrations after the sampled window', () => {
  const result = computeFairness([
    { expectedHeight: 100, effectiveSize: 1, members: [{ proTxHash: 'old', valid: true, operatorLabel: null }] },
  ], new Map([
    ['old', { host: 'fixture-host', operatorLabel: null, registeredHeight: 10 }],
    ['new', { host: 'fixture-host', operatorLabel: null, registeredHeight: 101 }],
  ]));
  expect(result.hosts[0]?.nodes).toBe(1);
  expect(result.neverSelected).not.toContain('new');
  expect(result.hosts[0]?.currentRegisteredNodes).toBe(2);
});

test('R5b fairness recovers after a temporary profile-resolution failure', async ({ app, page }) => {
  await page.clock.install({ time: new Date('2026-09-11T09:00:00Z') });
  app.stub({
    ...shellStubs(),
    '/api/v1/health': { body: ok(healthSnapshot()) },
    '/api/v1/chainlocks': { status: 503, body: fail('temporary outage') },
    '/api/v1/quorum-rounds/profiles': { body: ok({ items: [llmqProfile()] }) },
    '/api/v1/fairness/selection': { body: ok(selectionFairness()) },
  });
  await app.goto('/fairness');
  await expect.poll(() => app.callsTo('/api/v1/chainlocks').length).toBe(1);
  // Wait for the handled failure before restoring the endpoint.
  await expect(page.getByRole('button', { name: V2_PROFILE, exact: true })).toBeVisible();
  await page.waitForTimeout(100);
  app.stub({ '/api/v1/chainlocks': { body: ok(chainLockReport()) } });
  await page.clock.fastForward(60000);
  await expect.poll(() => app.callsTo('/api/v1/fairness/selection').length).toBeGreaterThan(0);
});

test('R7 an edited draft is a new create request even with the same seed', async ({ app, page }) => {
  app.stub(adminSessionStubs());
  await app.goto('/admin');
  const prepare = page.getByRole('button', { name: 'Prepare dry-run plan', exact: true });
  await expect(prepare).toBeEnabled();
  app.stub({ '/api/v1/admin/simulations/runs': { status: 503, body: fail('creation outcome uncertain') } });
  await prepare.click();
  await expect(page.getByText('creation outcome uncertain', { exact: true })).toBeVisible();
  await prepare.click();
  await expect.poll(() => app.requestsTo('/api/v1/admin/simulations/runs', 'POST').length).toBe(2);
  await expect(prepare).toBeEnabled();
  await page.locator('textarea').fill('{"count":2,"durationSeconds":60}');
  await prepare.click();
  await expect.poll(() => app.requestsTo('/api/v1/admin/simulations/runs', 'POST').length).toBe(3);
  const requests = app.requestsTo('/api/v1/admin/simulations/runs', 'POST');
  expect(requests[0].body).toEqual(requests[1].body);
  expect(requests[0].idempotencyKey).toBe(requests[1].idempotencyKey);
  expect(requests[1].body).not.toEqual(requests[2].body);
  expect(requests[1].idempotencyKey).not.toBe(requests[2].idempotencyKey);
});
