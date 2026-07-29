// Bundler-compatible replacement for zlibjs/bin/gunzip.min.js, which
// kuromoji's BrowserDictionaryLoader requires directly (see
// node_modules/kuromoji/src/loader/BrowserDictionaryLoader.js) to gunzip its
// dictionary files in the browser. Swapped in via the `resolve.alias` in
// vite.config.js and vitest.browser.config.js — aliasing this bare
// `zlibjs/bin/gunzip.min.js` specifier works reliably where aliasing
// kuromoji's own loader file did not, since Vite's alias step matches the
// literal specifier text in the `require(...)` call, and this one (unlike
// `./loader/NodeDictionaryLoader`, which only becomes
// `BrowserDictionaryLoader.js` via kuromoji's package.json "browser" field
// remap *after* alias resolution) is already the exact bare form used here.
//
// Two independent problems with the stock module, both from serving the
// dict's `*.dat.gz` files as plain static assets under public/assets/:
//
// 1. zlibjs's minified UMD wrapper reads top-level `this` to detect its host
//    (real CJS bundlers call it with `this` bound to `module.exports`) —
//    breaks under Vite/Rolldown's ESM-based bundling, where top-level `this`
//    is `undefined` per spec ("Cannot use 'in' operator to search for
//    'Zlib' in undefined"). Fixed by using pako instead (already in the tree
//    transitively via jeep-sqlite -> jszip).
// 2. Static file servers (Vite's dev server among them, via sirv) treat any
//    `.gz`-suffixed asset as a precompressed variant and serve it with
//    `Content-Encoding: gzip`, which the browser's network stack then
//    decompresses transparently before this code ever sees it — so
//    unconditionally gunzipping again fails ("incorrect header check").
//    Whether a given static host does this isn't something we control (dev
//    server vs. Capacitor/Electron's production asset serving may differ),
//    so `decompress()` checks the actual gzip magic bytes (1f 8b) on what
//    came back and only decompresses if they're still there.
const pako = require('pako');

exports.Zlib = {
  Gunzip: class {
    constructor(buffer) {
      this.buffer = buffer;
    }
    decompress() {
      const isGzipped = this.buffer.length > 2 && this.buffer[0] === 0x1f && this.buffer[1] === 0x8b;
      return isGzipped ? pako.ungzip(this.buffer) : this.buffer;
    }
  },
};
