// npm run build:db -- furigana
//
// Build-time only step (kuromoji is never shipped to the client — see
// PLAN.md's Phase 0 note; the client-side deconjugation feature in Phase 1
// ships its own copy of kuromoji.js separately). Tokenizes each kept example
// sentence (data/build/sentences.ndjson) with kuromoji/IPADIC and assigns a
// reading per token:
//   - if the token's surface form exactly matches a JMdict kanji headword,
//     use that entry's reading (tie-broken toward whichever candidate
//     reading agrees with kuromoji's own reading, then by commonnessScore)
//   - otherwise fall back to kuromoji's own reading, converted to hiragana
//   - tokens with no kanji get reading: null (nothing to annotate with ruby)
//
// Output: data/build/furigana.ndjson — { id, tokens: [{ surface, reading }] },
// keyed by sentence id, joined against sentences.ndjson at DB-assembly time.

import { createReadStream, createWriteStream, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import kuromoji from 'kuromoji';
import { toHiragana } from './lib/kana.mjs';
import { hasKanji } from './lib/kanji.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = path.join(__dirname, '../data/build');
const ENTRIES_FILE = path.join(BUILD_DIR, 'entries.ndjson');
const SENTENCES_FILE = path.join(BUILD_DIR, 'sentences.ndjson');
const OUT_FILE = path.join(BUILD_DIR, 'furigana.ndjson');
const DIC_PATH = path.join(__dirname, '../node_modules/kuromoji/dict');

async function buildKanjiIndex() {
  const index = new Map(); // kanjiText -> [{ readings: string[], score: number }]
  const rl = createInterface({
    input: createReadStream(ENTRIES_FILE, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    const e = JSON.parse(line);
    const readings = e.readings.map((r) => r.text);
    if (readings.length === 0) continue;
    for (const k of e.kanji) {
      if (!index.has(k.text)) index.set(k.text, []);
      index.get(k.text).push({ readings, score: e.commonnessScore });
    }
  }
  return index;
}

function buildTokenizer() {
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: DIC_PATH }).build((err, tokenizer) => {
      if (err) reject(err);
      else resolve(tokenizer);
    });
  });
}

function resolveReading(surface, kuromojiReadingHiragana, kanjiIndex) {
  const candidates = kanjiIndex.get(surface);
  if (!candidates || candidates.length === 0) return kuromojiReadingHiragana;
  const agreeing = candidates.find((c) => c.readings.includes(kuromojiReadingHiragana));
  if (agreeing) return kuromojiReadingHiragana;
  const best = candidates.reduce((a, b) => (b.score > a.score ? b : a));
  return best.readings[0];
}

async function main() {
  console.log('Building kanji headword index from entries.ndjson...');
  const kanjiIndex = await buildKanjiIndex();
  console.log(`  ${kanjiIndex.size} distinct kanji headwords indexed.`);

  console.log('Loading kuromoji/IPADIC tokenizer...');
  const tokenizer = await buildTokenizer();

  mkdirSync(BUILD_DIR, { recursive: true });
  const out = createWriteStream(OUT_FILE, { encoding: 'utf8' });

  const rl = createInterface({
    input: createReadStream(SENTENCES_FILE, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  console.log('Tokenizing sentences...');
  let count = 0;
  for await (const line of rl) {
    if (!line) continue;
    const { id, japanese } = JSON.parse(line);
    const morphemes = tokenizer.tokenize(japanese);
    const tokens = morphemes.map((m) => {
      const surface = m.surface_form;
      if (!hasKanji(surface)) return { surface, reading: null };
      const kuromojiReading = toHiragana(m.reading || surface);
      return { surface, reading: resolveReading(surface, kuromojiReading, kanjiIndex) };
    });
    out.write(JSON.stringify({ id, tokens }) + '\n');
    count++;
    if (count % 10000 === 0) console.log(`  ${count} sentences tokenized...`);
  }
  out.end();
  console.log(`Wrote furigana for ${count} sentences to ${OUT_FILE}`);
}

main();
