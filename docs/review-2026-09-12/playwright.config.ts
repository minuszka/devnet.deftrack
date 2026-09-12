import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import baseline from '../../client/playwright.config.js';

export default defineConfig({
  ...baseline,
  testDir: '.',
  testMatch: 'regressions.spec.ts',
  expect: { timeout: 2_000 },
  reporter: [['list']],
  outputDir: '../../client/test-results/review-days-01-10',
  webServer: {
    ...baseline.webServer,
    cwd: fileURLToPath(new URL('../../client', import.meta.url)),
  },
});
