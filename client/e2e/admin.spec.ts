import type { Page } from '@playwright/test';
import { expect, fail, ok, test, type ApiStubs, type StubResponse } from './harness.js';
import { adminSessionStubs, runStubs, RUN_A } from './fixtures/admin.js';

/**
 * `/admin` is its own shell, loaded by `main.ts` from the pathname alone, so it
 * is reached by a real navigation rather than through the public router.
 *
 * The first describe covers the two gates an anonymous browser can actually
 * see. The second stubs the sign-in exchange itself, and what it proves is
 * narrow on purpose: what the shell does with the answer. A session is minted by
 * the identity proxy, not by a stub, and nothing here is evidence that the proxy
 * authenticates anybody.
 */
test.describe('admin gate', () => {
  test('a 401 session shows the sign-in gate, not a dashboard', async ({ app, page }) => {
    app.stub({
      '/api/v1/admin/session': { status: 401, body: fail('no admin session') },
    });
    await app.goto('/admin');

    await expect(page.getByRole('heading', { name: 'Admin access', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue to admin dashboard' })).toBeVisible();

    // No private surface leaks into the signed-out gate.
    await expect(page.getByRole('button', { name: /sign out/i })).toHaveCount(0);
  });

  test('an unreachable session endpoint is distinguished from being signed out', async ({
    app,
    page,
  }) => {
    app.stub({
      '/api/v1/admin/session': { status: 500, body: fail('session store unavailable') },
    });
    await app.goto('/admin');

    await expect(
      page.getByRole('heading', { name: 'Admin access is unavailable', exact: true })
    ).toBeVisible();
    await expect(page.locator('.alert[role="alert"]')).toContainText('session store unavailable');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

const SESSION = '/api/v1/admin/session';
const SIGN_IN = 'Continue to admin dashboard';

/** Installed and stopped, so nothing but the sign-in itself can load the dashboard. */
async function stoppedClock(page: Page): Promise<void> {
  const start = new Date('2026-09-11T09:00:00.000Z');
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 1_000));
}

/** Signed out on arrival; the sign-in POST answers however `signIn` says. */
function signedOutUntil(signIn: StubResponse): ApiStubs {
  return {
    ...adminSessionStubs(),
    ...runStubs({ runKey: RUN_A, status: 'fault_active', live: true, faultMayBeActive: true }),
    [SESSION]: (_url, method) =>
      method === 'POST' ? signIn : { status: 401, body: fail('no admin session') },
  };
}

test.describe('signing in', () => {
  /**
   * V3 of the final review. A successful sign-in showed the signed-in page and
   * loaded nothing into it.
   *
   * The sign-in set the shell's loading flag and then asked for the dashboard,
   * and the dashboard load returns at once when that same flag is set. So the
   * operator saw "Sign out" above an empty panel -- no run, no scenarios -- until
   * the thirty-second refresh, a manual Refresh or a reload happened to fix it.
   * It was in the baseline too: inherited, not introduced.
   */
  test('a successful sign-in loads the dashboard and the selected run at once', async ({ app, page }) => {
    app.stub(
      signedOutUntil({
        body: ok({ subject: 'fixture-operator', role: 'operator', csrfToken: 'fixture-csrf-token' }),
      })
    );
    await stoppedClock(page);
    await app.goto(`/admin?run=${RUN_A}`);
    await expect(page.getByRole('button', { name: SIGN_IN })).toBeVisible();

    await page.getByRole('button', { name: SIGN_IN }).click();

    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    // No clock has moved: only the sign-in itself can have loaded these.
    await expect(page.locator('.run-state')).toContainText(RUN_A);
    await expect(page.getByRole('button', { name: 'Abort & recover' })).toBeVisible();
    expect(app.callsTo('/api/v1/admin/simulations/runs').length).toBeGreaterThan(0);
  });

  /** V3's constraint: the double-submit guard the shared flag gave for free has to survive. */
  test('two clicks on sign-in send one exchange', async ({ app, page }) => {
    const exchange = app.gate();
    app.stub(
      signedOutUntil({
        body: ok({ subject: 'fixture-operator', role: 'operator', csrfToken: 'fixture-csrf-token' }),
        gate: exchange,
      })
    );
    await stoppedClock(page);
    await app.goto(`/admin?run=${RUN_A}`);

    const button = page.getByRole('button', { name: SIGN_IN });
    await button.click();
    await exchange.waitForHeld(1);
    await expect(page.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    await page.getByRole('button', { name: 'Signing in…' }).click({ force: true, timeout: 2_000 }).catch(() => undefined);

    await exchange.release();
    await expect(page.locator('.run-state')).toContainText(RUN_A);
    expect(app.requestsTo(SESSION, 'POST')).toHaveLength(1);
  });

  /** V3's other constraint: a refused sign-in opens nothing. */
  test('a refused sign-in opens no private surface and asks for none', async ({ app, page }) => {
    app.stub(signedOutUntil({ status: 403, body: fail('subject is not an administrator') }));
    await stoppedClock(page);
    await app.goto(`/admin?run=${RUN_A}`);

    await page.getByRole('button', { name: SIGN_IN }).click();
    await app.waitUntilRead(SESSION, 2);

    await expect(page.locator('.alert[role="alert"]')).toContainText('Sign-in was not accepted');
    await expect(page.getByRole('button', { name: SIGN_IN })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
    await expect(page.locator('.run-state')).toHaveCount(0);
    expect(app.callsTo('/api/v1/admin/simulations/runs')).toHaveLength(0);
  });
});
