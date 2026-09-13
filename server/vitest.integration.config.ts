import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.js';

/**
 * The integration suite: real MongoDB, one file at a time, and a check at the
 * end that no test database survived the run (see
 * src/integration/leakCheck.globalSetup.ts).
 *
 * One file at a time is the fix for the day-6 flake -- fifteen files building
 * indexes against one mongod at once pushed the heavier hooks past their
 * timeout (src/integration/mongo.ts has the measurement).
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['src/integration/**/*.integration.test.ts'],
      fileParallelism: false,
      globalSetup: ['src/integration/leakCheck.globalSetup.ts'],
    },
  })
);
