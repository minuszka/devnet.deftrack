import { defineConfig } from 'vite';

// The client is served by the API host in production; in development Vite
// proxies /api to the local server so there is no CORS special-casing.
const API_TARGET = process.env.DEVNET_API_TARGET || 'http://127.0.0.1:4100';

export default defineConfig({
  server: {
    port: 5190,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
