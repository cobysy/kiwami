// npm run build:db -- zip
//
// Compresses data/build/dictionary.db (scripts/assemble-sqlite.mjs's output)
// into public/dictionary.db.zip, the only dictionary artifact that lives
// under public/ — and so the only one `vite build` ships — since it's the
// file actually tracked in git and fetched at runtime (see
// ensureDatabaseFromUrl in src/dictionary/sqlite-drivers/browser-sqlite-driver.js).
// jeep-sqlite's HTTP-import path natively unzips a `.zip` URL client-side via
// JSZip, so this needs no bespoke decompression code on the app side — just
// an entry named exactly `dictionary.db` inside the archive (jeep-sqlite
// derives its IndexedDB key from that entry's filename, and it must match
// the key the `.db` path would have produced, `dictionarySQLite.db`).
//
// dictionary.db is full of repeated JSON text (tag arrays, etc.) and
// compresses to roughly a third of its size — see PLAN-DICTIONARY-BUILD.md's
// "Transfer compression" note.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '../data/build/dictionary.db');
const DEST_DIR = path.join(__dirname, '../public');
const DEST = path.join(DEST_DIR, 'dictionary.db.zip');

if (!existsSync(SRC)) {
  console.error(`${SRC} not found — run "npm run build:db -- db" first.`);
  process.exit(1);
}

const zip = new JSZip();
zip.file('dictionary.db', readFileSync(SRC));
const buf = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
});
mkdirSync(DEST_DIR, { recursive: true });
writeFileSync(DEST, buf);

console.log(`Wrote ${path.relative(process.cwd(), DEST)} (${(buf.length / 1024 / 1024).toFixed(1)}MB)`);
