// npm run setup:wasm
//
// Copies sql.js's WASM binary to public/assets/sql-wasm.wasm, where
// jeep-sqlite (the browser fallback used by src/dictionary/sqlite-drivers/browser-sqlite-driver.js
// via @capacitor-community/sqlite, see PLAN.md Phase 1) expects to find it
// at runtime. Required after every `npm install` because it's a plain file
// copy out of node_modules, not something bundlers resolve automatically —
// wired into `postinstall` below so a fresh clone/`npm install` just works.
//
// Source: node_modules/sql.js/dist/sql-wasm.wasm (installed transitively via
// jeep-sqlite's own dependency on sql.js).
//
// package.json pins `sql.js` to exactly 1.11.0 (not `^1.11.0`) on purpose:
// jeep-sqlite@2.8.0 bundles frozen JS glue built against that exact sql.js
// WASM ABI. A newer patch/minor sql.js (tried 1.14.1) produces a wasm binary
// the glue can't instantiate ("LinkError: function import requires a
// callable"), and swapping in a differently-built sql.js binary fails the
// same way with a different runtime abort — the glue and the wasm have to
// come from the same build, not just a semver-compatible one.


import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm');
const DEST_DIR = path.join(__dirname, '../public/assets');
const DEST = path.join(DEST_DIR, 'sql-wasm.wasm');

if (!existsSync(SRC)) {
  console.error(`sql.js WASM not found at ${SRC} — is jeep-sqlite installed?`);
  process.exit(1);
}

mkdirSync(DEST_DIR, { recursive: true });
copyFileSync(SRC, DEST);
console.log(`Copied sql-wasm.wasm -> ${path.relative(process.cwd(), DEST)}`);
