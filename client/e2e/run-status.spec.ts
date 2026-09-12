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
});
