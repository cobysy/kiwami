// Extracts data/build/dictionary.db from public/dictionary.db.zip (the file
// tracked in git, see scripts/zip-db.mjs) if it isn't already there.
// Deliberately extracted outside public/ — nothing in the browser bundle
// reads the raw file (jeep-sqlite fetches the .zip directly), so keeping it
// out of public/ means `vite build` never ships this uncompressed 134MB
// copy alongside the 49MB zip.
//
// Imported directly by every bit of node:sqlite-backed tooling that needs
// the raw file — tests/node/dictionary.test.js, scripts/verify-db.mjs — so
// each is self-sufficient on a fresh clone with no separate setup step to
// remember. Idempotent: skips extraction if the output already exists.
// Also runnable directly (`npm run setup:db`) as a manual escape hatch.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '../public/dictionary.db.zip');
const DEST_DIR = path.join(__dirname, '../data/build');
const DEST = path.join(DEST_DIR, 'dictionary.db');

export async function ensureDictionaryDb() {
  if (existsSync(DEST)) return DEST;
  if (!existsSync(SRC)) throw new Error(`${SRC} not found.`);

  const zip = await JSZip.loadAsync(readFileSync(SRC));
  const entry = zip.file('dictionary.db');
  if (!entry) throw new Error(`${SRC} has no "dictionary.db" entry.`);

  mkdirSync(DEST_DIR, { recursive: true });
  writeFileSync(DEST, await entry.async('nodebuffer'));
  return DEST;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const existedBefore = existsSync(DEST);
  const dest = await ensureDictionaryDb();
  console.log(existedBefore
    ? `${path.relative(process.cwd(), dest)} already exists, skipping.`
    : `Extracted ${path.relative(process.cwd(), dest)}`);
}
