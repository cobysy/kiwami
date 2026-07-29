# Dictionary engine notes

This file documents Phase 1's dictionary engine (query layer + platform drivers), built
against the SQLite database [README-DICTIONARY-BUILD.md](README-DICTIONARY-BUILD.md)
produces. For the project overview, see [README.md](README.md); for the roadmap, see
[PLAN.md](PLAN.md).

## Layout

- [src/dictionary/sqlite-driver.js](src/dictionary/sqlite-driver.js): the shared SQLite driver
  interface (`open`/`exec`/`all`/`run`/`close`) every backend implements. The query layer
  alongside it is written only against this shape.
- [src/dictionary/sqlite-drivers/node-sqlite-driver.js](src/dictionary/sqlite-drivers/node-sqlite-driver.js):
  node:sqlite, used by the Node dev/test harness and (later) the Electron main process.
- [src/dictionary/sqlite-drivers/browser-sqlite-driver.js](src/dictionary/sqlite-drivers/browser-sqlite-driver.js):
  the Capacitor SQLite plugin's web fallback (`jeep-sqlite`, backed by `sql.js`/WASM), used
  for the `vite dev` browser dev harness and browser test suite — the same web fallback the
  real iOS/Electron drivers will eventually swap in for.
- The rest of [src/dictionary/](src/dictionary/) is the platform-agnostic query layer — tiered
  plain-text match + wildcards (`search.js`), fuzzy kana matching (`fuzzy.js`), verb/adjective
  deconjugation (`deconjugate.js`, backed by a hand-rolled rule set plus a `kuromoji` tokenizer
  fallback in `tokenizer.js`), and the shared entry-hydration helper (`dictionary-entries.js`).
  `kuromoji-gunzip-shim.cjs` and `browser-path-shim.cjs` aren't part of the query layer itself —
  they're `resolve.alias` targets (wired in `vite.config.js`/`vitest.browser.config.js`) that
  patch two bundler-incompatibilities in kuromoji's browser dictionary loader; see the findings
  below.
- [src/App.vue](src/App.vue): a minimal dev harness (not Phase 2's real UI) for exercising the
  query layer by hand in a browser tab.
- [tests/](tests/): `tests/shared/run-dictionary-suite.js` holds the actual test bodies, run against
  both drivers via `tests/node/dictionary.test.js` and `tests/browser/dictionary.test.js`, proving the
  same query layer behaves identically regardless of which driver is underneath. Runs against the
  real `public/dictionary.db` (read-only), not a hand-picked fixture — see the findings below on
  why that's fast enough in both drivers; every test anchor (entry IDs, headwords) is a real
  dictionary entry looked up directly, the same way `verify-db.mjs`'s example queries are.

## Scripts

- `npm run dev` — starts the Vite dev server (the dev harness at `src/App.vue`).
- `npm run build` — production build (`vite build`).
- `npm run test` — runs both suites below in sequence.
- `npm run test:node` — dictionary test suite against the Node/node:sqlite driver.
- `npm run test:browser` — the same suite against the browser/jeep-sqlite driver, in a real
  headless Chromium via Playwright (`vitest`'s browser mode).
- `npm run setup:wasm` — copies `sql.js`'s WASM binary to `public/assets/sql-wasm.wasm`, where
  the browser driver expects it. Runs automatically on `npm install` (`postinstall`).
- `npm run setup:kuromoji` — copies `kuromoji`'s IPADIC dictionary files to
  `public/assets/kuromoji-dict/`, where `tokenizer.js`'s deconjugation fallback expects them
  (a filesystem dir in Node, a URL prefix in the browser). Runs automatically on `npm install`
  (`postinstall`).
- `npm run build:db -- db` — assembles `data/build/dictionary.db`. Kept out of `public/` so
  `vite build` never ships this uncompressed 134MB copy — see `npm run build:db -- zip` below.
- `npm run build:db -- zip` — compresses it to `public/dictionary.db.zip` (~1/3 the size, named
  `.zip` rather than leaving it as `.db` so jeep-sqlite's HTTP-import path, which switches on
  URL file extension, fetches and unzips it client-side natively — no app-side decompression
  code needed (`scripts/zip-db.mjs`, `ensureDatabaseFromUrl` in `browser-sqlite-driver.js`).
- `npm run setup:db` — the reverse: extracts `data/build/dictionary.db` back out of the
  tracked `.zip`, for the node:sqlite-backed tooling that reads it directly. A manual escape
  hatch — in practice that tooling (`tests/node/dictionary.test.js`, `scripts/verify-db.mjs`)
  calls the same `ensureDictionaryDb()` itself on demand, so a fresh clone needs no separate
  setup step or network access to resume dev (`scripts/unzip-db.mjs`).

## Findings from building this (see PLAN.md for the full write-up)

- **`sql.js` is pinned to exactly `1.11.0`, not `^1.11.0`.** `jeep-sqlite`'s bundled JS glue is
  frozen against a specific `sql.js` WASM build; a newer semver-compatible `sql.js` produces a
  WASM binary the glue can't instantiate. See `scripts/copy-sql-wasm.mjs`.
- **The real 134MB `dictionary.db` loads fine in the browser driver** — fetch+import in well
  under a second locally, despite `sql.js` holding the whole database in WASM memory.
- **kuromoji's browser dictionary loader needed two bundler-compat patches to run under
  Vite/Rolldown.** (1) It requires `zlibjs/bin/gunzip.min.js` for decompression; zlibjs's
  minified UMD wrapper reads top-level `this` to detect its host (real CJS bundlers call it with
  `this` bound to `module.exports`), which is `undefined` under Vite/Rolldown's ESM-based
  bundling ("Cannot use 'in' operator to search for 'Zlib' in undefined") — fixed by aliasing
  that specifier to `kuromoji-gunzip-shim.cjs`, which uses `pako` instead (already in the tree
  transitively via `jeep-sqlite` → `jszip`). (2) Vite's dev server (via `sirv`) serves any
  `.gz`-suffixed static asset with `Content-Encoding: gzip`, which the browser decompresses
  transparently before the app ever sees it — gunzipping that output again throws ("incorrect
  header check"). Since we don't control whether a given static host (dev server vs.
  Capacitor/Electron's production asset serving) does this, the shim checks the actual gzip
  magic bytes (`1f 8b`) and only decompresses if they're still present. (3) Node's `path` module,
  which the loader also calls (`path.join`), is externalized to an empty stub by Vite for the
  browser — fixed by aliasing `path` to `browser-path-shim.cjs`, a one-function `join`
  replacement (dict paths are always `/`-joined URLs, no drive letters or `..` to resolve).
