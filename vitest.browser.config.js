import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';

// See src/db/dictionary/kuromoji-gunzip-shim.cjs and browser-path-shim.cjs
// for why these aliases exist (same as vite.config.js).
const kuromojiGunzipShim = fileURLToPath(new URL('./src/db/dictionary/kuromoji-gunzip-shim.cjs', import.meta.url));
const browserPathShim = fileURLToPath(new URL('./src/db/dictionary/browser-path-shim.cjs', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      'zlibjs/bin/gunzip.min.js': kuromojiGunzipShim,
      path: browserPathShim,
    },
  },
  test: {
    name: 'browser',
    include: ['tests/browser/**/*.test.js'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
    testTimeout: 30000,
  },
});
