import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import baseline from '../../client/playwright.config.js';

const port = Number(process.env.DEVNET_E2E_PORT ?? 5294);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  ...baseline,
  testDir: '.',
  testMatch: 'regressions.spec.ts',
  testIgnore: [],
  workers: 1,
  expect: { timeout: 2500 },
  reporter: [['list']],
  outputDir: '../../client/test-results/review-final',
  use: { ...baseline.use, baseURL: origin },
  webServer: {
    ...baseline.webServer,
    command: `npx vite --config ../docs/review-2026-09-13/vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    url: origin,
    cwd: fileURLToPath(new URL('../../client', import.meta.url)),
  },
});
