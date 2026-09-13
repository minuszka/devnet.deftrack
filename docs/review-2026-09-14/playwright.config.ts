import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import baseline from '../../client/playwright.config.js';
const mode = process.env.REVIEW_MODE ?? 'probes';
const port = Number(process.env.DEVNET_E2E_PORT ?? 5494);
const origin = `http://127.0.0.1:${port}`;
const tests: Record<string, { testDir: string; testMatch: string | string[]; grep?: RegExp; repeatEach?: number }> = {
  probes: { testDir: '../review-2026-09-13-followup', testMatch: 'followup.spec.ts' },
  extra: { testDir: '.', testMatch: 'extra.spec.ts' },
  baseline: { testDir: '../../client/e2e', testMatch: ['run-status.spec.ts','fairness.spec.ts','public-simulations.spec.ts'], grep: /a 401 on the first evidence|a 401 on reading the evidence again|a 401 on a refreshed timeline|a failed refresh of the same page keeps|a tip-driven profile change that fails/ },
  harness: { testDir: './generated', testMatch: 'harness-negative.spec.ts', grep: /release waits for its own response|two held answers for one URL/ },
  'debt-old': { testDir: './generated', testMatch: 'debt-old.spec.ts', grep: /a poll describing an older state cannot undo an action/, repeatEach: 3 },
  'debt-new': { testDir: '../../client/e2e', testMatch: 'run-status.spec.ts', grep: /a poll describing an older state cannot undo an action/, repeatEach: 3 },
};
if (!tests[mode]) throw new Error(`Unknown review mode: ${mode}`);
export default defineConfig({ ...baseline, ...tests[mode], testIgnore: [], workers: 1,
  expect: { timeout: 2500 }, reporter: [['list']],
  outputDir: `./artifacts/${mode}-${process.env.REVIEW_MUTATION ?? 'none'}`,
  use: { ...baseline.use, baseURL: origin },
  webServer: { ...baseline.webServer,
    command: `npx vite --config ../docs/review-2026-09-14/vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    url: origin, cwd: fileURLToPath(new URL('../../client', import.meta.url)),
  },
});
