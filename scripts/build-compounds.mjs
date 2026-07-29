// npm run build:db -- compounds
//
// For each kanji character, precomputes which JMdict entries contain it in
// their headword (the entry's primary kanji form, same headword definition
// used for kanjiCount in build:entries), carrying the entry's commonnessScore
// along so the kanji detail view's compounds section can be shown common-first
// without a join-time sort against the full entries table.
//
// Only characters present in kanji.ndjson (KANJIDIC2's ~13,108 standard-use
// kanji) are kept — a handful of headwords use rarer variant characters
// outside that set (e.g. 仝, 靑) which have no kanji detail page to link to,
// so there'd be nothing for a compounds row to navigate to.
//
// Output: data/build/kanji_compounds.ndjson — { kanji, entryId, score }

import { createReadStream, createWriteStream, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = path.join(__dirname, '../data/build');
const ENTRIES_FILE = path.join(BUILD_DIR, 'entries.ndjson');
const KANJI_FILE = path.join(BUILD_DIR, 'kanji.ndjson');
const OUT_FILE = path.join(BUILD_DIR, 'kanji_compounds.ndjson');

const KANJI_RE = /[一-鿿㐀-䶿]/gu;

async function loadKnownKanji() {
  const known = new Set();
  const rl = createInterface({
    input: createReadStream(KANJI_FILE, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    known.add(JSON.parse(line).literal);
  }
  return known;
}

async function main() {
  const knownKanji = await loadKnownKanji();

  mkdirSync(BUILD_DIR, { recursive: true });
  const out = createWriteStream(OUT_FILE, { encoding: 'utf8' });
  const rl = createInterface({
    input: createReadStream(ENTRIES_FILE, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let entryCount = 0;
  let rowCount = 0;
  let skippedUnknown = 0;
  for await (const line of rl) {
    if (!line) continue;
    const e = JSON.parse(line);
    const headword = e.kanji[0]?.text;
    if (!headword) continue;
    const kanjiChars = new Set(headword.match(KANJI_RE) || []);
    for (const kanji of kanjiChars) {
      if (!knownKanji.has(kanji)) { skippedUnknown++; continue; }
      out.write(JSON.stringify({ kanji, entryId: e.id, score: e.commonnessScore }) + '\n');
      rowCount++;
    }
    entryCount++;
  }
  out.end();
  console.log(`Scanned ${entryCount} kanji-containing entries, wrote ${rowCount} kanji_compounds rows (skipped ${skippedUnknown} references to kanji outside KANJIDIC2) to ${OUT_FILE}`);
}

main();
