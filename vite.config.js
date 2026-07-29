import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

// See src/db/dictionary/kuromoji-gunzip-shim.cjs and browser-path-shim.cjs
// for why these aliases exist: kuromoji's browser dictionary loading breaks
// under Vite/Rolldown's browser bundling in two ways (a zlibjs UMD wrapper
// that assumes CJS `this` binding, and static-file-server gzip handling), and
// Node's 'path' module is externalized to an empty stub in the browser.
const kuromojiGunzipShim = fileURLToPath(new URL('./src/db/dictionary/kuromoji-gunzip-shim.cjs', import.meta.url));
const browserPathShim = fileURLToPath(new URL('./src/db/dictionary/browser-path-shim.cjs', import.meta.url));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      'zlibjs/bin/gunzip.min.js': kuromojiGunzipShim,
      path: browserPathShim,
    },
  },
});
