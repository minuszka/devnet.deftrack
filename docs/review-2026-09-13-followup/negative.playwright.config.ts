import { defineConfig } from '@playwright/test';
import original from '../review-2026-09-13/playwright.config.js';
export default defineConfig({
  ...original, testDir: '../../client/e2e',
  testMatch: ['run-status.spec.ts', 'admin.spec.ts', 'scenario-forms.spec.ts', 'query-identity.spec.ts', 'public-simulations.spec.ts'],
  grep: new RegExp(process.env.REVIEW_GREP ?? 'a late saved plan cannot roll|a late refresh carrying no proof yet|a successful sign-in loads|Blocks: a query that fails|an unreadable edit locks the fields|a report that could not be read is said so in the downloaded file|evidence that cannot be read is said as such'),
  outputDir: process.env.REVIEW_GREP ? '../../client/test-results/negative-followup-editor' : '../../client/test-results/negative-followup',
  webServer: { ...original.webServer,
    command: `npx vite --config ../docs/review-2026-09-13-followup/negative.vite.config.ts --host 127.0.0.1 --port ${Number(process.env.DEVNET_E2E_PORT ?? 5294)} --strictPort`,
  },
});
