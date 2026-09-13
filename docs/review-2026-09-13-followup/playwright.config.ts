import { defineConfig } from '@playwright/test';
import original from '../review-2026-09-13/playwright.config.js';
export default defineConfig({
  ...original, testDir: '.', testMatch: 'followup.spec.ts',
  outputDir: '../../client/test-results/followup-review',
});
