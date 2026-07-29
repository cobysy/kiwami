// npm run verify:db
//
// Sanity-checks public/dictionary.sqlite after `npm run build:db -- all` (or `-- db`):
// foreign key integrity, row counts per table, an FTS5 search spot check
// (kana reading + English gloss), a full entry reconstruction, the
// kanji -> kanji_compounds join (common-first ordering), the
// entry -> sentence -> furigana join, and the meta/attribution rows.
//
// Also prints the live schema (from sqlite_master) up front, so this script
// doubles as a quick tour of what's actually in the database for anyone
// who wasn't around when it was designed — read the printed CREATE TABLE
// statements alongside PLAN.md's Phase 0 section for the "why".
//
// Exits non-zero (and prints what failed) if any check fails, so this can
// also be run as a build-sanity gate, not just for manual inspection.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, '../public/dictionary.sqlite');

const KNOWN_TABLES = [
  'entries', 'entry_kanji', 'entry_readings', 'entry_senses', 'entry_glosses',
  'search_fts', 'kanji', 'kanji_compounds', 'sentences', 'entry_sentences', 'meta',
];

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failures++;
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

if (!existsSync(DB_FILE)) {
  console.error(`No database at ${DB_FILE}. Run \`npm run build:db\` first.`);
  process.exit(1);
}

console.log(`${DB_FILE} (${(statSync(DB_FILE).size / 1024 / 1024).toFixed(1)}MB)\n`);

const db = new Database(DB_FILE, { readonly: true });

console.log('=== Schema ===');
for (const row of db.prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY type DESC, name").all()) {
  if (row.sql) console.log(row.sql + ';');
}

console.log('\n=== Row counts ===');
for (const table of KNOWN_TABLES) {
  const { c } = db.prepare(`SELECT count(*) AS c FROM ${table}`).get();
  console.log(`  ${table.padEnd(18)} ${c}`);
}

console.log('\n=== Foreign key integrity ===');
const fkViolations = db.pragma('foreign_key_check');
check('no foreign key violations', fkViolations.length === 0, `${fkViolations.length} violation(s)`);

console.log('\n=== FTS5 search (search_fts covers readings + glosses) ===');
const byGloss = db.prepare("SELECT entry_id FROM search_fts WHERE search_fts MATCH 'obvious' LIMIT 10").all();
check('gloss search "obvious" returns results', byGloss.length > 0);
check('gloss search "obvious" finds 明白 (id 1000220)', byGloss.some((r) => r.entry_id === 1000220));

const byReading = db.prepare("SELECT entry_id FROM search_fts WHERE search_fts MATCH 'めいはく'").all();
check('reading search "めいはく" finds exactly 明白', byReading.length === 1 && byReading[0].entry_id === 1000220);

console.log('\n=== Entry reconstruction (id 1000220, 明白/めいはく) ===');
const entry = db.prepare('SELECT * FROM entries WHERE id = 1000220').get();
const kanjiText = db.prepare('SELECT text FROM entry_kanji WHERE entry_id = 1000220 ORDER BY ord LIMIT 1').get()?.text;
const readingText = db.prepare('SELECT text FROM entry_readings WHERE entry_id = 1000220 ORDER BY ord LIMIT 1').get()?.text;
const glosses = db.prepare('SELECT text FROM entry_glosses WHERE entry_id = 1000220 ORDER BY ord').all().map((r) => r.text);
check('kanji form is 明白', kanjiText === '明白', `got ${kanjiText}`);
check('reading is めいはく', readingText === 'めいはく', `got ${readingText}`);
check('glosses include "obvious"', glosses.includes('obvious'), `got ${glosses.join(', ')}`);
check('commonness_score > 0 (has priority tags)', entry?.commonness_score > 0);
check('is_archaic is false', entry?.is_archaic === 0);

console.log('\n=== Kanji + kanji_compounds join (明) ===');
const kanjiRow = db.prepare('SELECT * FROM kanji WHERE literal = ?').get('明');
check('明 exists in kanji table', !!kanjiRow);
check('明 has 8 strokes', kanjiRow?.stroke_count === 8, `got ${kanjiRow?.stroke_count}`);
const compounds = db.prepare(`
  SELECT kc.entry_id, kc.score,
    (SELECT text FROM entry_kanji WHERE entry_id = kc.entry_id ORDER BY ord LIMIT 1) AS headword
  FROM kanji_compounds kc WHERE kc.kanji = '明' ORDER BY kc.score DESC LIMIT 5
`).all();
check('明 has compound entries', compounds.length === 5);
check('compounds are sorted common-first', compounds.every((c, i) => i === 0 || c.score <= compounds[i - 1].score));

console.log('\n=== Sentence + furigana join (an entry linked to 明白) ===');
const sentenceRow = db.prepare(`
  SELECT s.* FROM entry_sentences es JOIN sentences s ON s.id = es.sentence_id
  WHERE es.entry_id = 1000220 LIMIT 1
`).get();
check('entry 1000220 has at least one linked sentence', !!sentenceRow);
if (sentenceRow) {
  const furigana = JSON.parse(sentenceRow.furigana);
  check('sentence japanese text contains 明白', sentenceRow.japanese.includes('明白'));
  check('furigana tokens parse as an array', Array.isArray(furigana) && furigana.length > 0);
  check('furigana includes a 明白 → めいはく token', furigana.some((t) => t.surface === '明白' && t.reading === 'めいはく'));
}

console.log('\n=== meta / attribution ===');
const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));
check('jmdict_kanjidic_attribution present', !!meta.jmdict_kanjidic_attribution);
check('tatoeba_attribution present', !!meta.tatoeba_attribution);

db.close();

console.log(`\n${failures === 0 ? '\x1b[32mAll checks passed.\x1b[0m' : `\x1b[31m${failures} check(s) failed.\x1b[0m`}`);
process.exit(failures === 0 ? 0 : 1);
