import { defineConfig } from 'vite';
import baseline from '../../client/vite.config.js';

// Other verification tasks can write HTML artefacts in this shared checkout.
// Those writes must not reload the page in the middle of a race reproduction.
// Application source, proxy configuration and production build stay unchanged.
export default defineConfig({
  ...baseline,
  server: {
    ...baseline.server,
    watch: { ignored: ['**/test-results*/**', '**/playwright-report/**', '**/review-shots/**'] },
  },
});
