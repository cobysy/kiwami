// npm run setup:kuromoji
//
// Copies kuromoji's bundled IPADIC dictionary files to
// public/assets/kuromoji-dict/, where src/db/dictionary/tokenizer.js expects
// to find them at runtime — kuromoji's own dictionary loader wants a
// filesystem directory in Node and a URL prefix in the browser, so shipping
// them under public/assets/ (same layout as sql-wasm.wasm, see
// copy-sql-wasm.mjs) covers both with one copy. Required after every
// `npm install` because it's a plain file copy out of node_modules, not
// something bundlers resolve automatically — wired into `postinstall` below
// so a fresh clone/`npm install` just works.
//
// Source: node_modules/kuromoji/dict/*.dat.gz (~17MB uncompressed across the
// trie/token-info/connection-cost/unknown-word tables kuromoji.builder()
// loads in parallel at tokenizer build time).

import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, '../node_modules/kuromoji/dict');
const DEST_DIR = path.join(__dirname, '../public/assets/kuromoji-dict');

if (!existsSync(SRC_DIR)) {
  console.error(`kuromoji dict not found at ${SRC_DIR} — is kuromoji installed?`);
  process.exit(1);
}

mkdirSync(DEST_DIR, { recursive: true });
const files = readdirSync(SRC_DIR).filter((f) => f.endsWith('.dat.gz'));
for (const file of files) {
  copyFileSync(path.join(SRC_DIR, file), path.join(DEST_DIR, file));
}
console.log(`Copied ${files.length} kuromoji dict files -> ${path.relative(process.cwd(), DEST_DIR)}`);
