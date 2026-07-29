// npm run setup:db
//
// Extracts public/dictionary.db.zip (the file tracked in git, see
// scripts/zip-db.mjs) into public/dictionary.db, where node:sqlite-backed
// tooling expects to read it directly: tests/node/dictionary.test.js,
// scripts/verify-db.mjs, scripts/screenshot.mjs. Skips extraction if the
// output already exists, same idempotent pattern as copy-sql-wasm.mjs and
// copy-kuromoji-dict.mjs. Required after every `npm install`/fresh clone —
// wired into `postinstall` below — so resuming dev never needs network
// access to rebuild the database from source.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '../public/dictionary.db.zip');
const DEST = path.join(__dirname, '../public/dictionary.db');

if (existsSync(DEST)) {
  console.log(`${path.relative(process.cwd(), DEST)} already exists, skipping.`);
  process.exit(0);
}

if (!existsSync(SRC)) {
  console.error(`${SRC} not found.`);
  process.exit(1);
}

const zip = await JSZip.loadAsync(readFileSync(SRC));
const entry = zip.file('dictionary.db');
if (!entry) {
  console.error(`${SRC} has no "dictionary.db" entry.`);
  process.exit(1);
}
writeFileSync(DEST, await entry.async('nodebuffer'));

console.log(`Extracted ${path.relative(process.cwd(), DEST)}`);
