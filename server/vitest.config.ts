import { defineConfig } from 'vitest/config';

// The compiled tree carries copies of every test (`tsc` includes src/**/*.ts),
// but not the fixtures beside them, so a suite run after a build would pick the
// dist copies up and fail on the missing JSON. Only the sources are tests.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
