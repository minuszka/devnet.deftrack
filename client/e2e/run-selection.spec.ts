import { expect, fail, ok, test } from './harness.js';
import {
  adminSessionStubs,
  controlRun,
  runStubs,
  savedPlan,
  RUN_A,
  RUN_B,
} from './fixtures/admin.js';

/**
 * F01: the controls for a running experiment could be lost.
 *
 * The selected run lived in one component's memory. A reload emptied it, so
 * the Abort button for a fault that was still live went with it -- and because
 * any edit to the draft form cleared the same field, typing one character in
 * the seed box did the same thing without a reload. Meanwhile the dashboard's
 * own refresh recomputed the selection as "the first active run, or whatever
 * was selected", so choosing a run and waiting thirty seconds could move the
 * panel somewhere else.
 *
 * The selection is in the URL now, and a refresh may not move it. What a
 * reload restores is the run and its SAVED plan, read back -- never a new run
 * created from the same form.
 */
const ABORT = 'Abort & recover';

test.describe('run selection', () => {
  test('a run in the URL is restored with its saved plan, not re-created', async ({
    app,
    page,
  }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'fault_active', live: true, faultMayBeActive: true }),
    });
    await app.goto(`/admin?run=${RUN_A}`);

    await expect(page.getByText(RUN_A, { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: ABORT })).toBeVisible();

    // The saved plan was read back. Nothing was created: a POST here would mint
    // a different run and leave the one holding the lab with no controls.
    expect(app.callsTo(`/api/v1/admin/simulations/runs/${RUN_A}/dry-run`).length).toBeGreaterThan(0);
    expect(app.requestsTo('/api/v1/admin/simulations/runs', 'POST')).toHaveLength(0);
  });

  test('editing the draft does not take the running experiment off the screen', async ({
    app,
    page,
  }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'fault_active', live: true, faultMayBeActive: true }),
    });
    await app.goto(`/admin?run=${RUN_A}`);
    await expect(page.getByRole('button', { name: ABORT })).toBeVisible();

    // The seed field: one character used to be enough to discard the run.
    await page.locator('input[type="text"]').first().fill('a-different-seed');
    await page.locator('textarea').fill('{"count": 2, "durationSeconds": 90}');

    await expect(page.getByRole('button', { name: ABORT })).toBeVisible();
  });

  test('a malformed key in the URL is an error, not a different run', async ({ app, page }) => {
    app.stub({
      ...adminSessionStubs(),
      '/api/v1/admin/simulations/runs': {
        body: ok({ items: [{ runKey: RUN_B, status: 'fault_active', stateEnteredAtMs: 1 }], total: 1 }),
      },
      ...runStubs({ runKey: RUN_B }),
    });
    await app.goto('/admin?run=not-a-run-key');

    await expect(page.locator('.alert[role="alert"]').first()).toContainText('not a run key');
    // The active run must NOT have been adopted in its place.
    await expect(page.getByRole('button', { name: ABORT })).toHaveCount(0);
  });

  test('a key that does not resolve says so and keeps the address', async ({ app, page }) => {
    app.stub({
      ...adminSessionStubs(),
      [`/api/v1/admin/simulations/runs/${RUN_A}/history`]: {
        status: 404,
        body: fail('simulation run not found'),
      },
      [`/api/v1/admin/simulations/runs/${RUN_A}/dry-run`]: {
        status: 404,
        body: fail('simulation run not found'),
      },
      [`/api/v1/admin/simulations/runs/${RUN_A}/recovery`]: {
        status: 404,
        body: fail('simulation run not found'),
      },
    });
    await app.goto(`/admin?run=${RUN_A}`);

    // The message names the key: a bare "not found" beside a list of runs does
    // not say which one failed.
    await expect(page.locator('.alert[role="alert"]').filter({ hasText: RUN_A }).first()).toBeVisible();
    expect(new URL(page.url()).searchParams.get('run')).toBe(RUN_A);
    // And no controls for a run that could not be loaded.
    await expect(page.getByRole('button', { name: ABORT })).toHaveCount(0);
  });

  /**
   * The race a control surface must not lose: pick B while A is still in
   * flight, and A's answer must not land on B's panel.
   */
  test('a late answer for the previous run does not replace the current one', async ({
    app,
    page,
  }) => {
    const slowA = {
      run: controlRun({ runKey: RUN_A, status: 'fault_active', faultMayBeActive: true }),
      plan: savedPlan(RUN_A),
    };
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_B, status: 'armed' }),
      // A answers a second and a bit late. By then B is what the reader asked
      // for, and A's answer has to be dropped rather than drawn.
      [`/api/v1/admin/simulations/runs/${RUN_A}/dry-run`]: { body: ok(slowA), delayMs: 1_200 },
      [`/api/v1/admin/simulations/runs/${RUN_A}/history`]: {
        body: ok({ run: slowA.run, audit: [], artifacts: [] }),
        delayMs: 1_200,
      },
    });

    await app.goto(`/admin?run=${RUN_A}`);
    // Move to B without waiting for A, the way a click or Back would.
    await page.evaluate((key) => {
      history.pushState(null, '', `/admin?run=${key}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, RUN_B);

    await expect(page.getByText(RUN_B, { exact: false }).first()).toBeVisible();

    // Long enough for A to have answered.
    await page.waitForTimeout(1_800);

    expect(new URL(page.url()).searchParams.get('run')).toBe(RUN_B);
    await expect(page.getByText(RUN_B, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(RUN_A, { exact: false })).toHaveCount(0);
  });

  /**
   * The panel could not show recovery evidence at all: the run projection does
   * not carry it, so the line that claimed "all targets clear" was unreachable
   * code. It has its own endpoint now, and three answers rather than two.
   */
  test('recovery evidence is shown when the server has it', async ({ app, page }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({
        runKey: RUN_A,
        status: 'cooldown',
        recovery: {
          required: true,
          allClear: true,
          targets: [
            {
              targetId: 'lab-mn-1',
              faultStateClear: true,
              expectedServiceRunning: true,
              observerFresh: true,
              checkedAtMs: 2_000,
            },
          ],
        },
      }),
    });
    await app.goto(`/admin?run=${RUN_A}`);

    await expect(page.locator('.approval')).toContainText('all targets clear');
    await expect(page.locator('.approval')).toContainText('1 targets checked');
  });

  test('no recovery proof reads as unknown, never as clear', async ({ app, page }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'fault_active', faultMayBeActive: true }),
    });
    await app.goto(`/admin?run=${RUN_A}`);

    await expect(page.locator('.approval')).toContainText('No recovery proof has been recorded');
    await expect(page.locator('.approval')).toContainText('A fault may still be active');
    await expect(page.locator('.approval')).not.toContainText('all targets clear');
  });

  /**
   * A session that ended while the panel was open. The controls must go with
   * it: an Abort button that cannot authenticate is worse than none, because it
   * looks like a way out.
   */
  test('a session that ends takes the controls with it', async ({ app, page }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'fault_active', faultMayBeActive: true }),
    });
    await app.goto(`/admin?run=${RUN_A}`);
    await expect(page.getByRole('button', { name: ABORT })).toBeVisible();

    // Everything private now answers 401, as it would after the cookie expired.
    for (const path of [
      '/api/v1/admin/simulations/targets',
      '/api/v1/admin/simulations/runs',
      '/api/v1/admin/simulations/scenarios',
      `/api/v1/admin/simulations/runs/${RUN_A}/history`,
      `/api/v1/admin/simulations/runs/${RUN_A}/dry-run`,
      `/api/v1/admin/simulations/runs/${RUN_A}/recovery`,
    ]) {
      app.stub({ [path]: { status: 401, body: fail('no admin session') } });
    }
    await page.getByRole('button', { name: 'Refresh' }).click();

    await expect(page.getByRole('heading', { name: 'Admin access', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: ABORT })).toHaveCount(0);
  });

  /**
   * Everything below was found by an independent review of days 1-10, which
   * reproduced each one before it was reported. They are here rather than in
   * the review's own folder because a test that is not in the gate is not a
   * gate: these run with `npm run test:e2e -w client`, on every CI push.
   */

  /**
   * R1. Choosing another run while the first is still on screen.
   *
   * The key moved to the new run at once and the run object did not, so for as
   * long as the load took, the panel showed the OLD run's Abort button under
   * the NEW run's key -- and pressing it sent a real abort to a live fault
   * nobody was looking at any more.
   */
  test('a selection that is still loading offers no controls for the one before it', async ({
    app,
    page,
  }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'fault_active', faultMayBeActive: true }),
      ...runStubs({ runKey: RUN_B }),
      // B takes its time. That window is the whole defect.
      [`/api/v1/admin/simulations/runs/${RUN_B}/dry-run`]: {
        body: ok({ run: controlRun({ runKey: RUN_B }), plan: savedPlan(RUN_B) }),
        delayMs: 1_500,
      },
      [`/api/v1/admin/simulations/runs/${RUN_A}/abort`]: {
        body: ok({ run: controlRun({ runKey: RUN_A, status: 'cooldown', revision: 4 }) }),
      },
    });
    await app.goto(`/admin?run=${RUN_A}`);
    await expect(page.locator('.run-state')).toContainText(RUN_A);

    await page.evaluate((key) => {
      history.pushState(null, '', `/admin?run=${key}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, RUN_B);
    await expect.poll(() => app.callsTo(`/api/v1/admin/simulations/runs/${RUN_B}/dry-run`).length).toBe(1);

    // The whole selection goes, not only the controls: the timeline beside them
    // must not still be reading out the previous run's audit trail under the
    // new run's key.
    await expect(page.getByText('Select a recorded run to view its')).toBeVisible();

    // Press it if it is there at all -- so a failure records the request that
    // would really have gone out, rather than only the button's existence.
    const abort = page.getByRole('button', { name: ABORT });
    if ((await abort.count()) > 0 && (await abort.isEnabled())) await abort.click();
    expect(app.requestsTo(`/api/v1/admin/simulations/runs/${RUN_A}/abort`, 'POST')).toHaveLength(0);
  });

  /**
   * R2. The same race, losing.
   *
   * The success branch checked which run it belonged to; the failure branch did
   * not. So run A's slow 503 arriving after the operator had moved on cleared
   * run B's run, plan, evidence and timeline, and put A's error in their place.
   * A test above covers the same race on the success path -- it was green while
   * this was broken, which is what an untested branch looks like.
   */
  test('a late failure for the previous run does not erase the current one', async ({
    app,
    page,
  }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A }),
      ...runStubs({ runKey: RUN_B }),
      [`/api/v1/admin/simulations/runs/${RUN_A}/dry-run`]: {
        status: 503,
        body: fail('the run store is unavailable'),
        delayMs: 1_200,
      },
    });
    await app.goto(`/admin?run=${RUN_A}`);
    await expect.poll(() => app.callsTo(`/api/v1/admin/simulations/runs/${RUN_A}/dry-run`).length).toBe(1);

    await page.evaluate((key) => {
      history.pushState(null, '', `/admin?run=${key}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, RUN_B);
    await expect(page.locator('.run-state')).toContainText(RUN_B);

    // Long enough for A's failure to have arrived.
    await page.waitForTimeout(1_600);

    expect(new URL(page.url()).searchParams.get('run')).toBe(RUN_B);
    await expect(page.locator('.run-state')).toContainText(RUN_B);
  });

  /**
   * R4. A confirmation is about one run.
   *
   * The two acknowledgement boxes were cleared when a new plan was prepared and
   * at no other time, so confirming the start of run A left run B's "Confirm
   * and start" enabled with nobody having confirmed anything about B.
   */
  test('a start confirmation does not travel to the next run', async ({ app, page }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A }),
      ...runStubs({ runKey: RUN_B }),
    });
    await app.goto(`/admin?run=${RUN_A}`);
    await expect(page.locator('.run-state')).toContainText(RUN_A);

    await page.getByRole('checkbox', { name: /I confirm/ }).check();
    const start = page.getByRole('button', { name: 'Confirm and start', exact: true });
    await expect(start).toBeEnabled();

    await page.evaluate((key) => {
      history.pushState(null, '', `/admin?run=${key}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, RUN_B);

    await expect(page.locator('.run-state')).toContainText(RUN_B);
    await expect(start).toBeDisabled();
  });

  /**
   * The second half of R1, on its own.
   *
   * White-box on purpose. The dashboard drops the previous run before loading
   * the next, so a panel whose run and selection disagree should now be
   * unreachable through the interface -- which is an argument for the guard,
   * not evidence that it works. This forces the disagreement and asks the panel
   * what it does with it. Every button in that card sends a command naming
   * `run.runKey`; a card whose run is not the selected one must not exist.
   */
  test('a panel whose run is not the selected one offers nothing to press', async ({
    app,
    page,
  }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'fault_active', faultMayBeActive: true }),
    });
    await app.goto(`/admin?run=${RUN_A}`);
    await expect(page.getByRole('button', { name: ABORT })).toBeVisible();

    await page.evaluate((key) => {
      const panel = document
        .querySelector('dd-admin-shell')
        ?.shadowRoot?.querySelector('dd-simulation-control') as
        | (HTMLElement & { selectedRunKey: string | null })
        | null
        | undefined;
      if (panel) panel.selectedRunKey = key;
    }, RUN_B);

    await expect(page.getByRole('button', { name: ABORT })).toHaveCount(0);
    await expect(page.locator('.run-state')).toHaveCount(0);
  });

  test('signing out clears the run from the address bar', async ({ app, page }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A }),
    });
    await app.goto(`/admin?run=${RUN_A}`);
    await expect(page.getByText(RUN_A, { exact: false }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page.getByRole('heading', { name: 'Admin access', exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('run')).toBeNull();
  });
});
