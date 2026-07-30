// npm run build:db -- manifest
//
// Writes public/dictionary.manifest.json: the fingerprint of
// public/dictionary.db.zst that the browser reads to decide whether the copy
// already sitting in its IndexedDB is still the one this build ships.
//
// Why this file has to exist at all: the runtime cache is keyed on nothing
// but *presence*. ensureDatabaseFromUrl (see
// src/dictionary/sqlite-drivers/browser-sqlite-driver.js) skips the 40MB
// download whenever jeep-sqlite reports the database already imported, which
// is exactly right for a repeat visit and exactly wrong after a deploy: every
// browser that visited the old build keeps serving queries from the old
// schema forever, and the only escape used to be the manual reload button.
// Comparing this hash on load turns that into a self-healing re-import.
//
// Derived from the compressed artifact rather than data/build/dictionary.db,
// because the compressed artifact is what gets shipped and cached - if zstd
// output ever changed without the source changing (a different zstd version,
// say), browsers are holding different bytes and should re-import.
//
// A separate step from zstd-db.sh (which calls it as its last act) so the
// manifest can be regenerated on its own - recompressing at level 19 to
// recover a deleted 300-byte JSON file costs minutes.
//
// Deliberately no build timestamp in the output: this file is tracked in git
// next to the .zst, and a timestamp would rewrite it on every build even when
// the database is byte-for-byte identical.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_FILE = 'dictionary.db.zst';
const DB_PATH = path.join(ROOT, 'public', DB_FILE);
const MANIFEST_PATH = path.join(ROOT, 'public', 'dictionary.manifest.json');

if (!existsSync(DB_PATH)) {
  console.error(`public/${DB_FILE} not found — run "npm run build:db -- zstd" first.`);
  process.exit(1);
}

const hash = createHash('sha256');
for await (const chunk of createReadStream(DB_PATH)) hash.update(chunk);

const manifest = {
  file: DB_FILE,
  bytes: statSync(DB_PATH).size,
  sha256: hash.digest('hex'),
};
writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote public/dictionary.manifest.json (sha256 ${manifest.sha256.slice(0, 12)}…, ${manifest.bytes} bytes)`);
