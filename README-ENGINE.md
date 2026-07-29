# Dictionary engine notes

This file documents Phase 1's dictionary engine (query layer + platform drivers), built
against the SQLite database [README-DICTIONARY-BUILD.md](README-DICTIONARY-BUILD.md)
produces. For the project overview, see [README.md](README.md); for the roadmap, see
[PLAN.md](PLAN.md).

## Layout

- [src/db/driver.js](src/db/driver.js): the shared driver interface (`open`/`exec`/`all`/`run`/`close`)
  every backend implements. The query layer is written only against this shape.
- [src/db/drivers/node-driver.js](src/db/drivers/node-driver.js): better-sqlite3, used by the
  Node dev/test harness and (later) the Electron main process.
- [src/db/drivers/browser-driver.js](src/db/drivers/browser-driver.js): the Capacitor SQLite
  plugin's web fallback (`jeep-sqlite`, backed by `sql.js`/WASM), used for the `vite dev`
  browser dev harness and browser test suite — the same web fallback the real iOS/Electron
  drivers will eventually swap in for.
- [src/db/queries/](src/db/queries/): the platform-agnostic query layer — tiered plain-text
  match + wildcards (`search.js`), fuzzy kana matching (`fuzzy.js`), verb/adjective
  deconjugation (`deconjugate.js`), and the shared entry-hydration helper (`entries.js`).
- [src/App.vue](src/App.vue): a minimal dev harness (not Phase 2's real UI) for exercising the
  query layer by hand in a browser tab.
- [tests/](tests/): `tests/shared/run-engine-suite.js` holds the actual test bodies, run against
  both drivers via `tests/node/engine.test.js` and `tests/browser/engine.test.js`, proving the
  same query layer behaves identically regardless of which driver is underneath. Seeded through
  a small handpicked fixture (`tests/fixtures/`), not the real 164MB dictionary — see
  `tests/fixtures/seed.js` for why.

## Scripts

- `npm run dev` — starts the Vite dev server (the dev harness at `src/App.vue`).
- `npm run build` — production build (`vite build`).
- `npm run test` — runs both suites below in sequence.
- `npm run test:node` — engine test suite against the Node/better-sqlite3 driver.
- `npm run test:browser` — the same suite against the browser/jeep-sqlite driver, in a real
  headless Chromium via Playwright (`vitest`'s browser mode).
- `npm run setup:wasm` — copies `sql.js`'s WASM binary to `public/assets/sql-wasm.wasm`, where
  the browser driver expects it. Runs automatically on `npm install` (`postinstall`).
- `npm run build:db -- db` — assembles `public/dictionary.db`, tracked in git (see
  `scripts/assemble-sqlite.mjs`). It's named `.db` rather than `.sqlite` specifically so the
  dev harness's "load real dictionary" button can fetch it via jeep-sqlite's HTTP-import path —
  see `ensureDatabaseFromUrl` in `browser-driver.js` for why the extension matters.

## Findings from building this (see PLAN.md for the full write-up)

- **No FTS5 in the browser driver.** `jeep-sqlite`'s web fallback runs on `sql.js`, whose
  standard published WASM build has no FTS5 module. better-sqlite3 and iOS's native SQLite both
  support FTS5 fine, but the query layer targets the lowest common denominator so the same code
  runs identically on every driver — see the top of `src/db/queries/search.js`.
- **`sql.js` is pinned to exactly `1.11.0`, not `^1.11.0`.** `jeep-sqlite`'s bundled JS glue is
  frozen against a specific `sql.js` WASM build; a newer semver-compatible `sql.js` produces a
  WASM binary the glue can't instantiate. See `scripts/copy-sql-wasm.mjs`.
- **The real 164MB `dictionary.db` loads fine in the browser driver** — fetch+import in
  well under a second locally, despite `sql.js` holding the whole database in WASM memory. The
  `search_fts` (FTS5) table it contains doesn't block opening the file or querying other tables,
  even though the query layer never touches it there.
