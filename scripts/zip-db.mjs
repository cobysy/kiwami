// npm run build:db -- zip
//
// Compresses data/build/dictionary.db (scripts/assemble-sqlite.mjs's output)
// into public/dictionary.db.zip — one of the two dictionary artifacts
// tracked in git and shipped under public/ (see scripts/zstd-db.sh for the
// other, smaller one). jeep-sqlite's HTTP-import path natively unzips a
// `.zip` URL client-side via JSZip, so this needs no bespoke decompression
// code on the app side — just an entry named exactly `dictionary.db` inside
// the archive (jeep-sqlite derives its IndexedDB key from that entry's
// filename, and it must match the key the `.db` path would have produced,
// `dictionarySQLite.db`).
//
// This is the fallback/reference format: plain DEFLATE, decoded entirely by
// jeep-sqlite's own bundled JSZip with no extra client-side code. See
// ensureDatabaseFromUrl in src/dictionary/sqlite-drivers/browser-sqlite-driver.js
// for how the app picks between this and dictionary.db.zst — switching back
// to this format if the zstd path ever needs bypassing is a one-line change
// there (point the URL at `.zip` instead of `.zst`; no other code to touch).

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
