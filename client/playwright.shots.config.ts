import { defineConfig } from '@playwright/test';
import baseline from './playwright.config.js';

/**
 * Review screenshots, on demand: `npm run review:shots -w client`.
 *
 * Not part of the browser suite and not committed. The pictures are of the
 * paths a reviewer is most likely to doubt -- failing, loading, empty, refused,
 * signed out, on a phone -- rather than only the one where everything worked,
 * and they are made from the same synthetic fixtures the tests use, so a
 * reviewer who wants them regenerates them from the commit under review
 * instead of trusting images from another one.
 *
 * Written to client/review-shots/, which git ignores.
 */
export default defineConfig({
  ...baseline,
  testDir: './e2e',
  testMatch: 'review-shots.shots.ts',
  testIgnore: [],
  workers: 1,
  outputDir: 'test-results-shots',
  reporter: [['list']],
});
