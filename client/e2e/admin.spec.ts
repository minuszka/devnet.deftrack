import { expect, fail, test } from './harness.js';

/**
 * `/admin` is its own shell, loaded by `main.ts` from the pathname alone, so it
 * is reached by a real navigation rather than through the public router.
 *
 * Nothing here signs in. The tests cover the two gates an anonymous browser can
 * actually see, which is also the only admin surface a synthetic fixture may
 * honestly assert: a session is minted by the identity proxy, not by a stub.
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
