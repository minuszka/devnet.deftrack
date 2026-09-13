// Independent final review: these assert desired behavior, not expected failure.
// Existing harness intercepts all API traffic; no lab action reaches a server.
import { test, expect, ok, fail } from '../../client/e2e/harness.js';
import { adminSessionStubs, runStubs, controlRun, savedPlan, RUN_A } from '../../client/e2e/fixtures/admin.js';
import { loadedLayoutStubs } from '../../client/e2e/fixtures/layout.js';
import { shellStubs } from '../../client/e2e/fixtures/stubs.js';
import { SIM_A, simRun } from '../../client/e2e/fixtures/simulations.js';
import { buildSimulationExport } from '../../client/src/lib/simulations.js';

const A = `/api/v1/admin/simulations/runs/${RUN_A}`;
const now = new Date('2026-09-11T09:00:00Z');
const clear = { required: true, allClear: true, targets: [{ targetId: 'lab-mn-1', faultStateClear: true, expectedServiceRunning: true, observerFresh: true, checkedAtMs: 2000 }] };

test('V1 a late saved plan cannot roll a newer polled run back to armed', async ({ app, page }) => {
  await page.clock.install({ time: now });
  app.stub({
    ...adminSessionStubs(), ...runStubs({ runKey: RUN_A, status: 'armed', revision: 3 }),
    [`${A}/dry-run`]: { body: ok({ run: controlRun({ runKey: RUN_A, status: 'armed', revision: 3 }), plan: savedPlan(RUN_A) }), delayMs: 1500 },
    [A]: { body: ok(controlRun({ runKey: RUN_A, status: 'fault_active', faultMayBeActive: true, revision: 9 })) },
  });
  await app.goto(`/admin?run=${RUN_A}`);
  await expect.poll(() => app.callsTo(`${A}/dry-run`).length).toBe(1);
  await page.clock.fastForward(5000);
  await expect.poll(() => app.callsTo(A).length).toBeGreaterThan(0);
  // The plan is still in flight; wait until both responses have landed.
  await page.waitForTimeout(1800);
  await expect(page.locator('.run-state')).toContainText('fault_active');
  await expect(page.getByRole('button', { name: 'Confirm and start', exact: true })).toHaveCount(0);
});

test('V2 an old evidence refresh cannot overwrite newer clear proof for the same run', async ({ app, page }) => {
  await page.clock.install({ time: now });
  app.stub({ ...adminSessionStubs(), ...runStubs({ runKey: RUN_A, status: 'fault_active', faultMayBeActive: true }) });
  await app.goto(`/admin?run=${RUN_A}`);
  await expect(page.locator('.run-state')).toContainText('fault_active');
  app.stub({
    ...runStubs({ runKey: RUN_A, status: 'recovery', revision: 4 }),
    [`${A}/recovery`]: { body: ok({ recovery: null }), delayMs: 1500 },
  });
  await page.clock.fastForward(5000);
  await expect.poll(() => app.callsTo(`${A}/recovery`).length).toBeGreaterThan(1);
  app.stub(runStubs({ runKey: RUN_A, status: 'completed', revision: 5, recovery: clear }));
  await page.clock.fastForward(5000);
  await expect(page.locator('.approval')).toContainText('all targets clear');
  await page.waitForTimeout(1800);
  await expect(page.locator('.approval')).toContainText('all targets clear');
});

test('V3 successful sign-in immediately loads the selected run', async ({ app, page }) => {
  await page.clock.install({ time: now });
  app.stub({
    ...adminSessionStubs(), ...runStubs({ runKey: RUN_A, status: 'fault_active', faultMayBeActive: true }),
    '/api/v1/admin/session': { status: 401, body: fail('signed out') },
  });
  await app.goto(`/admin?run=${RUN_A}`);
  await expect(page.getByRole('button', { name: 'Continue to admin dashboard' })).toBeVisible();
  app.stub(adminSessionStubs());
  await page.getByRole('button', { name: 'Continue to admin dashboard' }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await expect(page.locator('.run-state')).toContainText(RUN_A);
});

test('V4 failed page two cannot relabel page one rows as page two', async ({ app, page }) => {
  app.stub(loadedLayoutStubs());
  await app.goto('/blocks');
  const firstLink = page.locator('dd-page-blocks tbody a').first();
  await expect(firstLink).toBeVisible();
  const href = await firstLink.getAttribute('href');
  app.stub({ '/api/v1/blocks': { status: 503, body: fail('page two unavailable') } });
  await page.getByRole('button', { name: 'Older', exact: true }).click();
  await expect(page.locator('dd-page-blocks .err')).toContainText('page two unavailable');
  expect(new URL(page.url()).searchParams.get('page')).toBe('2');
  // Retaining a snapshot is fine only when it is explicitly associated with
  // its own page. The current UI has no such snapshot label.
  await expect(page.locator(`dd-page-blocks tbody a[href="${href}"]`)).toHaveCount(0);
});

test('V5 unreadable Advanced JSON is not silently replaced by a form edit', async ({ app, page }) => {
  app.stub(adminSessionStubs());
  await app.goto('/admin');
  await page.getByRole('button', { name: /Advanced: the parameters as JSON/ }).click();
  const json = page.getByRole('textbox', { name: 'Scenario parameters as JSON' });
  const unfinished = '{"count": 7, "durationSeconds":';
  await json.fill(unfinished);
  await expect(page.getByRole('alert')).toContainText('cannot be read');
  await page.locator('#param-count').fill('2');
  await expect(json).toHaveValue(unfinished);
});

test('V6 failed report read is distinguishable from absent report in the export', () => {
  const run = simRun();
  const absent = buildSimulationExport(run, { kind: 'absent' }, now.getTime());
  const failed = buildSimulationExport(run, { kind: 'error', message: 'HTTP 503' }, now.getTime());
  expect(failed).not.toEqual(absent);
});

test('V7 an unavailable initial recovery read does not claim no proof was recorded', async ({ app, page }) => {
  app.stub({
    ...adminSessionStubs(), ...runStubs({ runKey: RUN_A, status: 'recovery', faultMayBeActive: true }),
    [`${A}/recovery`]: { status: 503, body: fail('evidence unavailable') },
  });
  await app.goto(`/admin?run=${RUN_A}`);
  await expect(page.locator('.run-state')).toContainText('recovery');
  await expect(page.locator('.approval')).not.toContainText('No recovery proof has been recorded');
});

test('C1 public missing report remains distinct from a missing run in the UI', async ({ app, page }) => {
  app.stub({ ...shellStubs(),
    [`/api/v1/simulations/${SIM_A}`]: { body: ok(simRun()) },
    [`/api/v1/simulations/${SIM_A}/report`]: { status: 404, body: fail('no report') },
  });
  await app.goto(`/simulations/${SIM_A}`);
  await expect(page.locator('[data-reading]')).toContainText('Completed, not yet measured');
});
