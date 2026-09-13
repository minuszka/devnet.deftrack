import type { Page } from '@playwright/test';
import { expect, fail, ok, test } from './harness.js';
import { adminSessionStubs, controlRun, runStubs, savedPlan, RUN_A, RUN_B } from './fixtures/admin.js';

/**
 * F02: the panel's state did not follow the server's.
 *
 * It held its own copy of the run, loaded once when the selection changed and
 * never renewed, while the dashboard beside it refreshed a list every thirty
 * seconds from a different request. So the list could show `recovery` while the
 * controls still offered to start a run that had finished, and the only thing
 * that ever corrected them was picking another run.
 *
 * One owner now: the dashboard fetches the run and hands it down. The clock is
 * controlled here because the poll is defined in seconds and waiting them out
 * would be slow and a guess.
 */
const START = new Date('2026-09-11T09:00:00.000Z');
const STATUS = '.run-state';

test.describe('run status', () => {
  /**
   * The whole lifecycle, driven only by what the server says. Nothing here is
   * inferred from a timer or from which button was pressed last.
   */
  test('follows the server through the states of a live run', async ({ app, page }) => {
    const states = ['activation_pending', 'fault_active', 'observing', 'recovery', 'cooldown', 'completed'];
    let index = 0;

    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: states[0], live: true }),
      // Each status read advances one state, as the server would.
      [`/api/v1/admin/simulations/runs/${RUN_A}`]: () => {
        const status = states[Math.min(index, states.length - 1)] as string;
        const run = controlRun({ runKey: RUN_A, status, revision: 3 + index, live: true });
        index += 1;
        return { body: ok(run) };
      },
    });

    await page.clock.install({ time: START });
    await app.goto(`/admin?run=${RUN_A}`);
    await expect(page.locator(STATUS)).toContainText('activation_pending');

    for (const expected of states.slice(1)) {
      await page.clock.fastForward(5_000);
      await expect(page.locator(STATUS)).toContainText(expected);
    }

    // A completed run stops being polled: it cannot change again.
    const before = app.callsTo(`/api/v1/admin/simulations/runs/${RUN_A}`).length;
    await page.clock.fastForward(30_000);
    expect(app.callsTo(`/api/v1/admin/simulations/runs/${RUN_A}`).length).toBe(before);
  });

  /**
   * The race in the other direction: the poll answering with a state the run
   * has already left, after an action moved it on. Arrival order would let the
   * older answer win; the server's revision does not.
   */
  test('a poll describing an older state cannot undo an action', async ({ app, page }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'fault_active', live: true, faultMayBeActive: true, revision: 5 }),
      [`/api/v1/admin/simulations/runs/${RUN_A}/abort`]: {
        body: ok({ run: controlRun({ runKey: RUN_A, status: 'aborting', revision: 9, live: true, faultMayBeActive: true }) }),
      },
      // The poll still answers with revision 5 -- a read that was already in
      // flight when the abort landed.
      [`/api/v1/admin/simulations/runs/${RUN_A}`]: {
        body: ok(controlRun({ runKey: RUN_A, status: 'fault_active', revision: 5, live: true, faultMayBeActive: true })),
      },
    });

    await page.clock.install({ time: START });
    await app.goto(`/admin?run=${RUN_A}`);
    await expect(page.locator(STATUS)).toContainText('fault_active');

    await page.getByRole('button', { name: 'Abort & recover' }).click();
    await expect(page.locator(STATUS)).toContainText('aborting');

    // Several ticks of the stale answer later, the abort still stands.
    await page.clock.fastForward(20_000);
    await expect(page.locator(STATUS)).toContainText('aborting');
  });

  test('two clicks on one control send one request', async ({ app, page }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'fault_active', live: true, faultMayBeActive: true, revision: 5 }),
      [`/api/v1/admin/simulations/runs/${RUN_A}/abort`]: {
        body: ok({ run: controlRun({ runKey: RUN_A, status: 'aborting', revision: 9, live: true }) }),
        // Slow enough that a second click has time to happen.
        delayMs: 700,
      },
    });

    await app.goto(`/admin?run=${RUN_A}`);
    const abort = page.getByRole('button', { name: 'Abort & recover' });
    await abort.click();
    // The control disables itself while the request is out, so this is a
    // no-op rather than a second abort.
    await abort.click({ force: true, timeout: 2_000 }).catch(() => undefined);

    await expect(page.locator(STATUS)).toContainText('aborting');
    expect(app.requestsTo(`/api/v1/admin/simulations/runs/${RUN_A}/abort`, 'POST')).toHaveLength(1);
  });

  /**
   * The same uncertain request repeated has to carry the key it was first sent
   * with -- that is what lets the server recognise a replay instead of refusing
   * it. A different run is a different request, and used to share the key.
   */
  test('an idempotency key belongs to one run and one operation', async ({ app, page }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'fault_active', live: true, faultMayBeActive: true }),
      ...runStubs({ runKey: RUN_B, status: 'fault_active', live: true, faultMayBeActive: true }),
      // A's abort fails, so its key stays owed and a retry must reuse it.
      [`/api/v1/admin/simulations/runs/${RUN_A}/abort`]: {
        status: 503,
        body: fail('the lab executor did not answer'),
      },
      [`/api/v1/admin/simulations/runs/${RUN_B}/abort`]: {
        body: ok({ run: controlRun({ runKey: RUN_B, status: 'aborting', revision: 9, live: true }) }),
      },
    });

    await app.goto(`/admin?run=${RUN_A}`);
    const abort = page.getByRole('button', { name: 'Abort & recover' });
    await abort.click();
    await expect(page.locator('.alert[role="alert"]').first()).toBeVisible();
    await abort.click();

    const aCalls = app.requestsTo(`/api/v1/admin/simulations/runs/${RUN_A}/abort`, 'POST');
    expect(aCalls).toHaveLength(2);
    // The retry of an uncertain request carries the key it was first sent
    // with: that is what lets the server recognise a replay rather than refuse
    // it, or worse, apply it twice.
    expect(aCalls[0]?.idempotencyKey).toBe(aCalls[1]?.idempotencyKey);
    expect(aCalls[0]?.idempotencyKey).not.toBeNull();

    // Then the same operation on another run, from the same panel.
    await page.evaluate((key) => {
      history.pushState(null, '', `/admin?run=${key}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, RUN_B);
    await expect(page.locator(STATUS)).toContainText(RUN_B);
    await page.getByRole('button', { name: 'Abort & recover' }).click();
    await expect(page.locator(STATUS)).toContainText('aborting');

    const bCalls = app.requestsTo(`/api/v1/admin/simulations/runs/${RUN_B}/abort`, 'POST');
    expect(bCalls).toHaveLength(1);
    // And a different run is a different request. Sharing A's key here would
    // have had the server recognise B's abort as a replay of A's -- so B would
    // never have been aborted, and the panel would have said it had been.
    expect(bCalls[0]?.idempotencyKey).not.toBe(aCalls[0]?.idempotencyKey);
  });

  /**
   * A lease is a deadline. Reading an expired one as "the fault is gone" is the
   * exact inversion: it is the moment the fault is most likely still there with
   * nothing watching it.
   */
  test('an expired lease is not a recovery proof', async ({ app, page }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({
        runKey: RUN_A,
        status: 'fault_active',
        live: true,
        faultMayBeActive: true,
        faultLeaseExpiresAtMs: START.getTime() - 1_000,
      }),
    });

    await page.clock.install({ time: START });
    await app.goto(`/admin?run=${RUN_A}`);

    await expect(page.locator('.countdown')).toContainText('expired');
    await expect(page.locator('.approval')).toContainText('No recovery proof has been recorded');
    await expect(page.locator('.approval')).not.toContainText('all targets clear');
    // And the way out is still offered.
    await expect(page.getByRole('button', { name: 'Retry recovery proof' })).toBeVisible();
  });

  test('a hidden tab stops asking', async ({ app, page }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'fault_active', live: true }),
    });
    await page.clock.install({ time: START });
    await app.goto(`/admin?run=${RUN_A}`);
    await expect(page.locator(STATUS)).toContainText('fault_active');

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hidden = app.callsTo(`/api/v1/admin/simulations/runs/${RUN_A}`).length;
    await page.clock.fastForward(30_000);
    expect(app.callsTo(`/api/v1/admin/simulations/runs/${RUN_A}`).length).toBe(hidden);

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect
      .poll(() => app.callsTo(`/api/v1/admin/simulations/runs/${RUN_A}`).length)
      .toBeGreaterThan(hidden);
  });

  test('a failed status read keeps the run and its controls', async ({ app, page }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'fault_active', live: true, faultMayBeActive: true }),
    });
    await page.clock.install({ time: START });
    await app.goto(`/admin?run=${RUN_A}`);
    await expect(page.getByRole('button', { name: 'Abort & recover' })).toBeVisible();

    app.stub({
      [`/api/v1/admin/simulations/runs/${RUN_A}`]: { status: 502, body: fail('gateway') },
    });
    await page.clock.fastForward(15_000);

    // The selection survives a failed read: taking the controls away from a
    // live fault because one request timed out is the worse failure.
    expect(new URL(page.url()).searchParams.get('run')).toBe(RUN_A);
    await expect(page.getByRole('button', { name: 'Abort & recover' })).toBeVisible();
    await expect(page.locator(STATUS)).toContainText('fault_active');
  });

  test('the saved plan is read once, not on every tick', async ({ app, page }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'fault_active', live: true }),
      [`/api/v1/admin/simulations/runs/${RUN_A}/dry-run`]: {
        body: ok({ run: controlRun({ runKey: RUN_A, status: 'fault_active', live: true }), plan: savedPlan(RUN_A) }),
      },
    });
    await page.clock.install({ time: START });
    await app.goto(`/admin?run=${RUN_A}`);
    await expect(page.locator(STATUS)).toContainText('fault_active');

    // One tick at a time, letting each request finish. Fast-forwarding through
    // several at once proves nothing here: the controller aborts whatever the
    // previous tick left in flight, so only the last one is ever issued -- which
    // is the "at most one status request outstanding" rule doing its job.
    let seen = app.callsTo(`/api/v1/admin/simulations/runs/${RUN_A}`).length;
    for (let tick = 0; tick < 3; tick += 1) {
      const before = seen;
      await page.clock.fastForward(5_000);
      await expect
        .poll(() => app.callsTo(`/api/v1/admin/simulations/runs/${RUN_A}`).length)
        .toBeGreaterThan(before);
      seen = app.callsTo(`/api/v1/admin/simulations/runs/${RUN_A}`).length;
    }

    // The plan is immutable; re-reading it five times a minute is load with no
    // information in it.
    expect(app.callsTo(`/api/v1/admin/simulations/runs/${RUN_A}/dry-run`)).toHaveLength(1);
    expect(seen).toBeGreaterThan(2);
  });

  /**
   * The rest of this file is the independent review of days 1-10, reproduced
   * here so it runs in the gate rather than beside the report.
   */

  const CLEAR = {
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
  };

  /**
   * R3. The poll read the run and only the run.
   *
   * Recovery evidence loaded once, on the initial read, so a run that reached
   * `cooldown` by itself -- a lease expiring, the server's own recovery
   * finishing -- showed the new status beside "No recovery proof has been
   * recorded for this run yet". That is the one thing an operator watching a
   * fault must not be told wrongly.
   */
  test('an automatic transition brings the evidence and the timeline with it', async ({
    app,
    page,
  }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'fault_active', live: true, faultMayBeActive: true }),
    });
    await page.clock.install({ time: START });
    await app.goto(`/admin?run=${RUN_A}`);
    await expect(page.locator('.approval')).toContainText('No recovery proof has been recorded');

    // The server finishes its own recovery: a new status, a new revision,
    // evidence that did not exist a moment ago, and an audit event to match.
    const recovered = controlRun({ runKey: RUN_A, status: 'cooldown', revision: 9, live: true });
    app.stub({
      ...runStubs({ runKey: RUN_A, status: 'cooldown', revision: 9, live: true, recovery: CLEAR }),
      [`/api/v1/admin/simulations/runs/${RUN_A}/history`]: {
        body: ok({
          run: recovered,
          audit: [
            { sequence: 1, stream: 'run', eventType: 'dry_run_completed', atMs: 2_000, fromStatus: 'draft', toStatus: 'armed' },
            { sequence: 2, stream: 'run', eventType: 'recovery_proven', atMs: 3_000, fromStatus: 'recovery', toStatus: 'cooldown' },
          ],
          artifacts: [],
        }),
      },
    });
    await page.clock.fastForward(5_000);

    await expect(page.locator(STATUS)).toContainText('cooldown');
    await expect(page.locator('.approval')).toContainText('all targets clear');
    await expect(page.locator('.timeline')).toContainText('recovery_proven');
  });

  /**
   * R3, the half that must not be fixed by refreshing harder.
   *
   * A refresh that fails is not an answer. Replacing what is held with "none
   * recorded" would report a recovery that HAS been proven as absent -- the
   * same class of mistake as reading unavailable evidence as "all clear", in
   * the other direction.
   */
  test('a failed evidence refresh keeps what was proven', async ({ app, page }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'cooldown', live: true, recovery: CLEAR }),
    });
    await page.clock.install({ time: START });
    await app.goto(`/admin?run=${RUN_A}`);
    await expect(page.locator('.approval')).toContainText('all targets clear');

    app.stub({
      [`/api/v1/admin/simulations/runs/${RUN_A}/recovery`]: {
        status: 503,
        body: fail('the evidence store did not answer'),
      },
      [`/api/v1/admin/simulations/runs/${RUN_A}`]: {
        body: ok(controlRun({ runKey: RUN_A, status: 'cooldown', revision: 11, live: true })),
      },
    });
    await page.clock.fastForward(5_000);

    await expect(page.locator('.approval')).toContainText('all targets clear');
    await expect(page.locator('.approval')).not.toContainText('No recovery proof has been recorded');
  });

  /** R3, after an action the operator took rather than one the server took. */
  test('a recovery the operator asks for shows the proof it produced', async ({ app, page }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'failed', live: true, faultMayBeActive: true }),
      [`/api/v1/admin/simulations/runs/${RUN_A}/recover`]: {
        body: ok({ run: controlRun({ runKey: RUN_A, status: 'cooldown', revision: 12, live: true }) }),
      },
    });
    await page.clock.install({ time: START });
    await app.goto(`/admin?run=${RUN_A}`);
    await expect(page.locator('.approval')).toContainText('No recovery proof has been recorded');

    // The proof exists from the moment the recovery runs -- and the panel used
    // to keep reading the copy it had loaded before it.
    //
    // The dashboard's own five tables are taken away at the same time, on
    // purpose. A first version of this test passed with the fix removed,
    // because the full dashboard reload that follows a mutation happened to
    // refresh the evidence on its way past -- so it was measuring the wrong
    // path. The run's endpoints still answer; the list beside them does not.
    app.stub({
      ...runStubs({ runKey: RUN_A, status: 'cooldown', revision: 12, live: true, recovery: CLEAR }),
      '/api/v1/admin/simulations/runs': { status: 503, body: fail('the run list did not answer') },
    });
    await page.getByRole('button', { name: 'Retry recovery proof' }).click();

    await expect(page.locator('.approval')).toContainText('all targets clear');
  });

  /**
   * R3's third case: Refresh, pressed on the selection already on screen.
   *
   * It re-read the five dashboard tables and not the run beside them, so the
   * one control an operator presses BECAUSE the panel looks stale was the one
   * that could not un-stale it.
   *
   * Isolated from the status poll deliberately: the run's own status and
   * revision do not move here, so the poll has nothing to notice and only
   * Refresh can bring the evidence in.
   */
  test('Refresh re-reads the selection that is already on screen', async ({ app, page }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'cooldown', live: true }),
    });
    await page.clock.install({ time: START });
    await app.goto(`/admin?run=${RUN_A}`);
    await expect(page.locator('.approval')).toContainText('No recovery proof has been recorded');

    app.stub(runStubs({ runKey: RUN_A, status: 'cooldown', live: true, recovery: CLEAR }));
    await page.getByRole('button', { name: 'Refresh' }).click();

    await expect(page.locator('.approval')).toContainText('all targets clear');
  });

  /**
   * R7. The create key was scoped to the draft's seed and nothing else.
   *
   * After a Prepare whose outcome was uncertain, editing any other field sent a
   * different body under the same key -- and the server binds a key to the
   * payload it first saw, so the corrected draft could not be created at all
   * until the page was reloaded.
   */
  test('an edited draft is a new create request, on the same seed', async ({ app, page }) => {
    app.stub(adminSessionStubs());
    await app.goto('/admin');
    const prepare = page.getByRole('button', { name: 'Prepare dry-run plan', exact: true });
    await expect(prepare).toBeEnabled();

    // Uncertain: it may or may not have been applied, which is the only reason
    // a retry has to carry the key the first attempt used.
    app.stub({
      '/api/v1/admin/simulations/runs': { status: 503, body: fail('the run store did not answer') },
    });
    await prepare.click();
    await expect(page.locator('.alert[role="alert"]').first()).toBeVisible();
    await prepare.click();
    await expect.poll(() => app.requestsTo('/api/v1/admin/simulations/runs', 'POST').length).toBe(2);

    // Now one field moves, and nothing else -- not the seed. Through the form,
    // which is how a draft is edited since day 15.
    await page.locator('#param-count').fill('2');
    await prepare.click();
    await expect.poll(() => app.requestsTo('/api/v1/admin/simulations/runs', 'POST').length).toBe(3);

    const posts = app.requestsTo('/api/v1/admin/simulations/runs', 'POST');
    expect(posts[0]?.body).toEqual(posts[1]?.body);
    expect(posts[0]?.idempotencyKey).toBe(posts[1]?.idempotencyKey);
    expect(posts[1]?.body).not.toEqual(posts[2]?.body);
    expect(posts[1]?.idempotencyKey).not.toBe(posts[2]?.idempotencyKey);
  });

  /** And the other half: a draft edit owes nothing to a run's owed keys. */
  test('editing the draft leaves an owed abort key exactly where it was', async ({ app, page }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'fault_active', live: true, faultMayBeActive: true }),
      [`/api/v1/admin/simulations/runs/${RUN_A}/abort`]: {
        status: 503,
        body: fail('the lab executor did not answer'),
      },
    });
    await app.goto(`/admin?run=${RUN_A}`);
    const abort = page.getByRole('button', { name: 'Abort & recover' });
    await abort.click();
    await expect(page.locator('.alert[role="alert"]').first()).toBeVisible();

    await page.locator('#param-count').fill('3');
    await abort.click();

    const calls = app.requestsTo(`/api/v1/admin/simulations/runs/${RUN_A}/abort`, 'POST');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.idempotencyKey).toBe(calls[1]?.idempotencyKey);
  });

  /**
   * Everything below was found by the final independent review (2026-09-13),
   * and each case failed on main before it was fixed. The review's own probes
   * are in docs/review-2026-09-13; these are the gate's versions, and the order
   * of the answers in them is stated with held responses rather than hoped for
   * with delays.
   */

  const A = `/api/v1/admin/simulations/runs/${RUN_A}`;
  const PLAN_UNREAD = 'The saved plan for this run could not be read';
  const ABORT = 'Abort & recover';
  const START_BUTTON = 'Confirm and start';

  /**
   * The page clock, installed and stopped.
   *
   * Installed alone, it keeps running in real time, so the status poll fires by
   * itself every five seconds -- and a poll landing inside an assertion's retry
   * window repairs exactly the rollback that assertion is there to catch. The
   * first version of the V1 test passed on the unfixed code for that reason.
   * Stopped, the poll ticks only when the test moves the clock, which makes it
   * one more answer whose order the test states.
   */
  async function stoppedClock(page: Page): Promise<void> {
    await page.clock.install({ time: START });
    await page.clock.pauseAt(new Date(START.getTime() + 1_000));
  }

  /**
   * V1. The saved plan arrived after a newer status, and rolled the run back.
   *
   * The first read fetches the run together with its plan, and it wrote that
   * run without asking whether it was older than the one already held -- the
   * one read of the run that skipped the revision rule the poll and every
   * mutation obey. A status read that landed while the plan was still on its
   * way, which is exactly what a slow first load invites, was overwritten: the
   * panel went back to `armed` and offered to start a run whose fault was
   * active.
   */
  test('a late saved plan cannot roll a newer run back', async ({ app, page }) => {
    const plan = app.gate();
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'armed', revision: 3, live: true }),
      [`${A}/dry-run`]: {
        body: ok({ run: controlRun({ runKey: RUN_A, status: 'armed', revision: 3, live: true }), plan: savedPlan(RUN_A) }),
        gate: plan,
      },
      [A]: {
        body: ok(controlRun({ runKey: RUN_A, status: 'fault_active', revision: 9, live: true, faultMayBeActive: true })),
      },
    });
    await stoppedClock(page);
    await app.goto(`/admin?run=${RUN_A}`);
    await plan.waitForHeld(1);

    // The status read gets there first, and is read.
    await page.clock.fastForward(5_000);
    await app.waitUntilRead(A, 1);

    await plan.release();
    // The plan has been read and drawn...
    await expect(page.getByText('Target preview')).toBeVisible();
    // ...and the older run that came with it changed nothing.
    await expect(page.locator(STATUS)).toContainText('fault_active');
    await expect(page.getByRole('button', { name: START_BUTTON, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: ABORT })).toBeVisible();
  });

  /** V1, the other order: the plan first, then a newer status. Still the newer one wins. */
  test('a newer status after the saved plan still lands', async ({ app, page }) => {
    const plan = app.gate();
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'armed', revision: 3, live: true }),
      [`${A}/dry-run`]: {
        body: ok({ run: controlRun({ runKey: RUN_A, status: 'armed', revision: 3, live: true }), plan: savedPlan(RUN_A) }),
        gate: plan,
      },
      [A]: {
        body: ok(controlRun({ runKey: RUN_A, status: 'fault_active', revision: 9, live: true, faultMayBeActive: true })),
      },
    });
    await stoppedClock(page);
    await app.goto(`/admin?run=${RUN_A}`);
    await plan.waitForHeld(1);

    await plan.release();
    await expect(page.locator(STATUS)).toContainText('armed');
    await expect(page.getByRole('button', { name: START_BUTTON, exact: true })).toBeVisible();

    await page.clock.fastForward(5_000);
    await app.waitUntilRead(A, 1);
    await expect(page.locator(STATUS)).toContainText('fault_active');
    await expect(page.getByRole('button', { name: START_BUTTON, exact: true })).toHaveCount(0);
  });

  /**
   * V1, the failure branch. A saved plan that cannot be read is a missing plan,
   * not a missing run.
   *
   * The failure used to clear everything -- including a run the status poll had
   * already accepted -- and the panel drew nothing at all without a plan, so a
   * live fault lost its Abort button because one read of an immutable document
   * failed. What the plan is needed for (preflight, arming, starting) is not
   * offered without it; the way out is.
   */
  test('a saved plan that cannot be read leaves the run and its abort', async ({ app, page }) => {
    const plan = app.gate();
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'armed', revision: 3, live: true }),
      [`${A}/dry-run`]: { status: 503, body: fail('the plan store did not answer'), gate: plan },
      [A]: {
        body: ok(controlRun({ runKey: RUN_A, status: 'fault_active', revision: 9, live: true, faultMayBeActive: true })),
      },
      [`${A}/abort`]: {
        body: ok({ run: controlRun({ runKey: RUN_A, status: 'aborting', revision: 10, live: true, faultMayBeActive: true }) }),
      },
    });
    await stoppedClock(page);
    await app.goto(`/admin?run=${RUN_A}`);
    await plan.waitForHeld(1);

    await page.clock.fastForward(5_000);
    await app.waitUntilRead(A, 1);
    // While the plan is still on its way, the run is known, and so is its way out.
    await expect(page.locator(STATUS)).toContainText('fault_active');
    await expect(page.getByRole('button', { name: ABORT })).toBeVisible();

    await plan.release();
    await expect(page.getByText(PLAN_UNREAD)).toBeVisible();
    await expect(page.locator('.alert[role="alert"]').first()).toContainText('the plan store did not answer');
    await expect(page.locator(STATUS)).toContainText('fault_active');
    for (const name of [START_BUTTON, 'Arm approved plan', 'Validate preflight']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    }

    // And the abort that is offered works.
    await page.getByRole('button', { name: ABORT }).click();
    await expect(page.locator(STATUS)).toContainText('aborting');
    expect(app.requestsTo(`${A}/abort`, 'POST')).toHaveLength(1);
  });

  /** V1: without its plan an armed run is not started -- and reading the plan again restores it. */
  test('without its saved plan an armed run cannot be started, until the plan is read again', async ({
    app,
    page,
  }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'armed', revision: 3, live: true }),
      [`${A}/dry-run`]: { status: 503, body: fail('the plan store did not answer') },
    });
    await stoppedClock(page);
    await app.goto(`/admin?run=${RUN_A}`);
    await app.waitUntilRead(`${A}/dry-run`, 1);

    await page.clock.fastForward(5_000);
    await app.waitUntilRead(A, 1);
    await expect(page.locator(STATUS)).toContainText('armed');
    await expect(page.getByText(PLAN_UNREAD)).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /I confirm/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: START_BUTTON, exact: true })).toHaveCount(0);

    const retry = app.gate();
    app.stub({
      ...runStubs({ runKey: RUN_A, status: 'armed', revision: 3, live: true }),
      [`${A}/dry-run`]: {
        body: ok({ run: controlRun({ runKey: RUN_A, status: 'armed', revision: 3, live: true }), plan: savedPlan(RUN_A) }),
        gate: retry,
      },
    });
    await page.getByRole('button', { name: 'Read the saved plan again' }).click();
    await retry.waitForHeld(1);
    // While the retry is out, the panel says the plan is being read -- not that
    // it could not be -- and offers no second retry on top of the first.
    await expect(page.getByText('The saved plan for this run is still being read')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Read the saved plan again' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: START_BUTTON, exact: true })).toHaveCount(0);

    await retry.release();
    await expect(page.getByText('Target preview')).toBeVisible();
    await expect(page.getByText(PLAN_UNREAD)).toHaveCount(0);
    await expect(page.getByRole('button', { name: START_BUTTON, exact: true })).toBeVisible();
  });

  /** V1, the same for arming: a risk acknowledged without the plan on screen is not an acknowledgement. */
  test('without its saved plan a scheduled run cannot be armed', async ({ app, page }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'scheduled', revision: 3, live: true }),
      [`${A}/dry-run`]: { status: 503, body: fail('the plan store did not answer') },
    });
    await stoppedClock(page);
    await app.goto(`/admin?run=${RUN_A}`);
    await app.waitUntilRead(`${A}/dry-run`, 1);

    await page.clock.fastForward(5_000);
    await app.waitUntilRead(A, 1);
    await expect(page.locator(STATUS)).toContainText('scheduled');
    await expect(page.getByText(PLAN_UNREAD)).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /I acknowledge/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Arm approved plan', exact: true })).toHaveCount(0);
  });

  /** V1: keeping the run through a failed plan read must not keep it through an ended session. */
  test('a saved plan read that answers 401 still ends the session', async ({ app, page }) => {
    const plan = app.gate();
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'fault_active', revision: 9, live: true, faultMayBeActive: true }),
      [`${A}/dry-run`]: { status: 401, body: fail('no admin session'), gate: plan },
    });
    await stoppedClock(page);
    await app.goto(`/admin?run=${RUN_A}`);
    await plan.waitForHeld(1);
    await page.clock.fastForward(5_000);
    await app.waitUntilRead(A, 1);

    await plan.release();
    await expect(page.getByRole('heading', { name: 'Admin access', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: ABORT })).toHaveCount(0);
  });
});
