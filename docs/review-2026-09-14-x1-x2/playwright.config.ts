import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../../../deftrack-review-458b6d0/client/playwright.config.js';
const mode = process.env.REVIEW_MODE ?? 'old';
const port = Number(process.env.DEVNET_E2E_PORT ?? 5594);
const root = '../../../deftrack-review-458b6d0';
const sets: Record<string, any> = {
  old: { testDir: `${root}/docs/review-2026-09-13-followup`, testMatch: 'followup.spec.ts' },
  extra: { testDir: `${root}/docs/review-2026-09-14`, testMatch: 'extra.spec.ts' },
  effects: { testDir: '.', testMatch: 'effects.spec.ts' },
  baseline: { testDir: `${root}/client/e2e`, testMatch: 'run-status.spec.ts', grep: /ends the session beside a/ },
  harness: { testDir: './generated', testMatch: 'harness-negative.spec.ts', grep: /release waits for its own response|two held answers for one URL/ },
};
if (!sets[mode]) throw new Error(mode);
export default defineConfig({ ...base, ...sets[mode], testIgnore: [], workers: 1,
  reporter: [['list']], expect: { timeout: 2500 },
  outputDir: `./artifacts/${mode}`,
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: { ...base.webServer,
    command: `npx vite --config "D:/www/devnet .deftrack/docs/review-2026-09-14-x1-x2/vite.config.ts" --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`, cwd: fileURLToPath(new URL(`${root}/client`, import.meta.url)),
  },
});
