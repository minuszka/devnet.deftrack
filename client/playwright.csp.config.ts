import { defineConfig } from '@playwright/test';
import baseline from './playwright.config.js';

/**
 * The CSP check, against the BUILT client rather than the dev server.
 *
 * It has to be the build: the dev server rewrites modules, injects its own
 * client and runs Lit in dev mode, so a policy that passes there says nothing
 * about the bundle nginx actually serves. `vite preview` serves exactly what
 * `vite build` wrote, on its own port, so this can run beside the ordinary
 * browser suite without either noticing the other.
 */
export default defineConfig({
  ...baseline,
  testDir: './e2e',
  testMatch: 'csp.spec.ts',
  // Undone from the baseline, which ignores exactly this file so the ordinary
  // suite cannot run it against the dev server. Spreading the baseline without
  // this made the config ignore the one test it exists to run -- and report
  // "0 tests" as a success.
  testIgnore: [],
  outputDir: 'test-results',
  use: {
    ...baseline.use,
    baseURL: 'http://127.0.0.1:5192',
  },
  webServer: {
    // Built here rather than assumed: this config is also run on its own, and
    // a stale dist would make the measurement describe the previous commit.
    command: 'npm run build && npx vite preview --host 127.0.0.1 --port 5192 --strictPort',
    url: 'http://127.0.0.1:5192/',
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});
