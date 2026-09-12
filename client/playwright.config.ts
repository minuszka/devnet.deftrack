import { defineConfig } from '@playwright/test';

/**
 * Browser tests for the client.
 *
 * They render the real application against a local Vite dev server and answer
 * every API call from a stub (see `e2e/harness.ts`). Two things follow from
 * that, and both are deliberate:
 *
 *   - The API server is never started. A green run says the client behaves
 *     correctly for a given response; it is not evidence about the server, the
 *     database, the node or the devnet.
 *   - The dev server's `/api` proxy is pointed at a closed port. Interception
 *     in the browser is the first line of defence and the proxy target is the
 *     second: a request that somehow escapes the harness must fail loudly
 *     rather than reach whatever happens to be listening on :4100.
 *
 * The browser is pinned with the `@playwright/test` version -- an exact pin, not
 * a range, because the Chromium build is chosen by that version and "the same
 * version string" has named three different binaries on this project before.
 */
const PORT = Number(process.env.DEVNET_E2E_PORT ?? 5191);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  /*
   * `csp.spec.ts` is deliberately not part of this suite.
   *
   * It measures the shipped Content-Security-Policy against the BUILT client,
   * served by `vite preview` (playwright.csp.config.ts). Run here it would
   * measure the dev server instead -- which rewrites modules, injects its own
   * client and runs Lit in dev mode -- so it would pass while saying nothing
   * about the bundle nginx serves, and a real failure in the build would be
   * masked by a green run against something else.
   */
  testIgnore: 'csp.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries: a test that passes on the second attempt is a defect report,
  // not a pass, and hiding it here is how a suite stops meaning anything.
  retries: 0,
  // Capped rather than one-per-core: every worker drives the same Vite dev
  // server, and past four of them the contention shows up as assertion
  // timeouts that look like flaky behaviour and are not. Retries would hide
  // that; a realistic budget fixes it.
  workers: process.env.CI ? 1 : 4,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    // Bound to the IPv4 loopback explicitly: Vite's default `localhost` binds
    // whatever the host resolves it to -- on Windows that is the IPv6 loopback
    // alone, and the readiness probe for 127.0.0.1 then never answers. It also
    // keeps the origin a literal, which is what the harness compares against.
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    // Never adopt a server somebody else started: it would carry the developer's
    // own proxy target, which is exactly the escape hatch this config closes.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { DEVNET_API_TARGET: 'http://127.0.0.1:1' },
  },
});
