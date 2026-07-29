// npm run build:db -- sentences
//
// Joins Tatoeba's JMdict-linked Japanese sentences to dictionary entries.
//
// Inputs (from `npm run build:db -- tatoeba`):
//   jpn_indices.csv               sentence_id \t eng_sentence_id \t tagged_text
//                                  tagged_text tokens look like headword(reading)[sense]{surface}~,
//                                  e.g. "二十歳(はたち){２０歳}" = headword 二十歳, reading はたち,
//                                  actual surface text in the sentence ２０歳.
//   jpn_sentences_detailed.tsv    id \t "jpn" \t text \t username \t date_added \t date_modified
//   eng_sentences_detailed.tsv    id \t "eng" \t text \t username \t date_added \t date_modified
//   jpn-eng_links.tsv             jpn_id \t eng_id (fallback when an index row's own
//                                  eng_sentence_id isn't in eng_sentences_detailed.tsv)
// Plus data/build/entries.ndjson (from `npm run build:db -- entries`), used to
// resolve each tagged token's headword(+reading) to a dictionary entry id.
//
// The "detailed" (not plain) per-language exports are used specifically to
// capture the contributor username: Tatoeba sentences are CC BY 2.0 FR,
// which requires crediting the individual sentence author, not just
// "Tatoeba" generically — see PLAN.md Phase 0's attribution bullet. Each
// output sentence carries its Japanese and English author (independently,
// since a translation can come from a different contributor than the
// original) so the app can render per-sentence credit.
//
// Matching: a token's headword is looked up against every entry's kanji AND
// reading text. If the token carries an explicit reading, candidates are
// filtered to entries whose readings include it. Remaining ambiguity (a
// headword shared by multiple entries, no reading given) is broken by
// picking the highest commonnessScore entry — best-effort, not exact; tokens
// with zero candidates are skipped rather than guessed at.
//
// Trimming: each entry keeps at most MAX_SENTENCES_PER_ENTRY example
// sentences, shortest Japanese text first (per PLAN.md Phase 0: "favouring
// shorter/simpler sentences if there's a choice").
//
// Output:
//   data/build/sentences.ndjson        { id, japanese, japaneseAuthor, english, englishAuthor }
//   data/build/entry_sentences.ndjson  { entryId, sentenceId }  (join table, post-trim)

import { readFileSync, mkdirSync, createWriteStream, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, '../data/raw/tatoeba');
const BUILD_DIR = path.join(__dirname, '../data/build');
const ENTRIES_FILE = path.join(BUILD_DIR, 'entries.ndjson');
const OUT_SENTENCES = path.join(BUILD_DIR, 'sentences.ndjson');
const OUT_JOIN = path.join(BUILD_DIR, 'entry_sentences.ndjson');

const MAX_SENTENCES_PER_ENTRY = 5;
const TOKEN_RE = /^([^(){}\[\]~]+)(?:\(([^)]+)\))?(?:\[(\d+)\])?(?:\{([^}]+)\})?(~)?$/u;

function loadDetailedTsvMap(file) {
  // id \t lang \t text \t username \t date_added \t date_modified
  const map = new Map();
  const raw = readFileSync(file, 'utf8');
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const cols = line.split('\t');
    if (cols.length < 4) continue;
    const [id, , text, username] = cols;
    map.set(id, { text, author: username && username !== '\\N' ? username : null });
  }
  return map;
}

function loadLinksMap(file) {
  const map = new Map();
  const text = readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    if (!line) continue;
    const [jpnId, engId] = line.split('\t');
    if (!jpnId || !engId) continue;
    if (!map.has(jpnId)) map.set(jpnId, []);
    map.get(jpnId).push(engId);
  }
  return map;
}

console.log('Loading Tatoeba sentence/link tables...');
const jpnSentences = loadDetailedTsvMap(path.join(RAW_DIR, 'jpn_sentences_detailed.tsv'));
const engSentences = loadDetailedTsvMap(path.join(RAW_DIR, 'eng_sentences_detailed.tsv'));
const jpnEngLinks = loadLinksMap(path.join(RAW_DIR, 'jpn-eng_links.tsv'));
console.log(`  ${jpnSentences.size} jpn sentences, ${engSentences.size} eng sentences, ${jpnEngLinks.size} jpn ids with links.`);

console.log('Building entry lookup index from entries.ndjson...');
const entryIndex = new Map(); // text -> [{id, score, readings}]
function indexText(text, candidate) {
  if (!text) return;
  if (!entryIndex.has(text)) entryIndex.set(text, []);
  entryIndex.get(text).push(candidate);
}

async function buildEntryIndex() {
  const rl = createInterface({
    input: createReadStream(ENTRIES_FILE, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let count = 0;
  for await (const line of rl) {
    if (!line) continue;
    const e = JSON.parse(line);
    const readings = e.readings.map((r) => r.text);
    const candidate = { id: e.id, score: e.commonnessScore, readings };
    for (const k of e.kanji) indexText(k.text, candidate);
    for (const r of e.readings) indexText(r.text, candidate);
    count++;
  }
  console.log(`  Indexed ${count} entries (${entryIndex.size} distinct surface forms).`);
}

function resolveToken(headword, reading) {
  const candidates = entryIndex.get(headword);
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].id;
  if (reading) {
    const filtered = candidates.filter((c) => c.readings.includes(reading));
    if (filtered.length > 0) {
      return filtered.reduce((best, c) => (c.score > best.score ? c : best)).id;
    }
  }
  return candidates.reduce((best, c) => (c.score > best.score ? c : best)).id;
}

function parseTaggedText(tagged) {
  const entryIds = new Set();
  for (const token of tagged.split(' ')) {
    if (!token) continue;
    const m = TOKEN_RE.exec(token);
    if (!m) continue;
    const [, headword, reading] = m;
    const id = resolveToken(headword, reading);
    if (id != null) entryIds.add(id);
  }
  return entryIds;
}

async function main() {
  await buildEntryIndex();

  console.log('Parsing jpn_indices.csv and joining to entries...');
  const indicesText = readFileSync(path.join(RAW_DIR, 'jpn_indices.csv'), 'utf8');
  const lines = indicesText.split('\n').filter(Boolean);

  const keptSentences = new Map(); // sentenceId -> { japanese, japaneseAuthor, english, englishAuthor }
  const entryToSentences = new Map(); // entryId -> [{ sentenceId, length }]
  let noJapanese = 0;
  let noEnglish = 0;
  let noTokenMatches = 0;

  for (const line of lines) {
    const tab1 = line.indexOf('\t');
    const tab2 = line.indexOf('\t', tab1 + 1);
    if (tab1 === -1 || tab2 === -1) continue;
    const jpnId = line.slice(0, tab1);
    const preferredEngId = line.slice(tab1 + 1, tab2);
    const tagged = line.slice(tab2 + 1);

    const jpn = jpnSentences.get(jpnId);
    if (!jpn) { noJapanese++; continue; }

    let eng = engSentences.get(preferredEngId);
    if (!eng) {
      const fallbackIds = jpnEngLinks.get(jpnId) || [];
      for (const id of fallbackIds) {
        eng = engSentences.get(id);
        if (eng) break;
      }
    }
    if (!eng) { noEnglish++; continue; }

    const entryIds = parseTaggedText(tagged);
    if (entryIds.size === 0) { noTokenMatches++; continue; }

    keptSentences.set(jpnId, {
      japanese: jpn.text,
      japaneseAuthor: jpn.author,
      english: eng.text,
      englishAuthor: eng.author,
    });
    for (const entryId of entryIds) {
      if (!entryToSentences.has(entryId)) entryToSentences.set(entryId, []);
      entryToSentences.get(entryId).push({ sentenceId: jpnId, length: jpn.text.length });
    }
  }

  console.log(`  ${lines.length} index rows: ${noJapanese} missing JP text, ${noEnglish} missing EN text, ${noTokenMatches} with no resolvable entry.`);
  console.log(`  ${keptSentences.size} sentences kept, linked to ${entryToSentences.size} entries (pre-trim).`);

  console.log(`Trimming to ${MAX_SENTENCES_PER_ENTRY} shortest sentences per entry...`);
  mkdirSync(BUILD_DIR, { recursive: true });
  const joinOut = createWriteStream(OUT_JOIN, { encoding: 'utf8' });
  const usedSentenceIds = new Set();
  let joinRows = 0;

  for (const [entryId, sentences] of entryToSentences) {
    sentences.sort((a, b) => a.length - b.length);
    const trimmed = sentences.slice(0, MAX_SENTENCES_PER_ENTRY);
    for (const s of trimmed) {
      joinOut.write(JSON.stringify({ entryId: Number(entryId), sentenceId: Number(s.sentenceId) }) + '\n');
      usedSentenceIds.add(s.sentenceId);
      joinRows++;
    }
  }
  joinOut.end();

  const sentencesOut = createWriteStream(OUT_SENTENCES, { encoding: 'utf8' });
  for (const id of usedSentenceIds) {
    const s = keptSentences.get(id);
    sentencesOut.write(JSON.stringify({
      id: Number(id),
      japanese: s.japanese,
      japaneseAuthor: s.japaneseAuthor,
      english: s.english,
      englishAuthor: s.englishAuthor,
    }) + '\n');
  }
  sentencesOut.end();

  console.log(`Wrote ${usedSentenceIds.size} sentences to ${OUT_SENTENCES}`);
  console.log(`Wrote ${joinRows} entry-sentence links to ${OUT_JOIN}`);
}

main();
