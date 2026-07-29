// npm run verify:db
//
// Sanity-checks data/build/dictionary.db after `npm run build:db -- all` (or `-- db`):
// foreign key integrity, row counts per table, a substring search spot check
// (kana reading + English gloss, mirroring src/dictionary/search.js's
// LIKE-scan), a full entry reconstruction, the kanji -> kanji_compounds join
// (common-first ordering), the entry -> sentence -> furigana join, and the
// meta/attribution rows.
//
// Also prints the live schema (from sqlite_master) up front, so this script
// doubles as a quick tour of what's actually in the database for anyone
// who wasn't around when it was designed — read the printed CREATE TABLE
// statements alongside PLAN.md's Phase 0 section for the "why". The
// "Example queries" section at the end continues that tour with realistic
// query patterns (gloss/reading search, kanji-count filter, archaic
// labeling, kanji detail + compounds, sentence + furigana) — each one
// prints both the SQL and its actual result rows, meant as copy-pasteable
// reference for whoever builds Phase 1's UI against this schema next.
//
// Exits non-zero (and prints what failed) if any check fails, so this can
// also be run as a build-sanity gate, not just for manual inspection.

import { statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ensureDictionaryDb } from './unzip-db.mjs';

const KNOWN_TABLES = [
  'entries', 'entry_kanji', 'entry_readings', 'entry_senses', 'entry_glosses',
  'tag_lists', 'kanji', 'kanji_compounds', 'sentences', 'entry_sentences', 'meta',
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

let DB_FILE;
try {
  DB_FILE = await ensureDictionaryDb();
} catch (err) {
  console.error(`${err.message} Run \`npm run build:db\` first.`);
  process.exit(1);
}

console.log(`${DB_FILE} (${(statSync(DB_FILE).size / 1024 / 1024).toFixed(1)}MB)\n`);

const db = new DatabaseSync(DB_FILE, { readOnly: true });

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
const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
check('no foreign key violations', fkViolations.length === 0, `${fkViolations.length} violation(s)`);

console.log('\n=== Substring search (entry_glosses / entry_readings, LIKE-scan) ===');
const byGloss = db.prepare("SELECT DISTINCT entry_id FROM entry_glosses WHERE text LIKE '%obvious%' LIMIT 10").all();
check('gloss search "obvious" returns results', byGloss.length > 0);
check('gloss search "obvious" finds 明白 (id 1000220)', byGloss.some((r) => r.entry_id === 1000220));

const byReading = db.prepare("SELECT DISTINCT entry_id FROM entry_readings WHERE text = 'めいはく'").all();
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

function runExample(title, sql, params = []) {
  console.log(`\n--- ${title} ---`);
  console.log(sql.trim().replace(/\n\s+/g, '\n  '));
  console.log('→');
  const rows = db.prepare(sql).all(...params);
  console.log(rows.length ? rows : '(no rows)');
  return rows;
}

console.log('\n=== Example queries ===');
console.log('(realistic usage patterns against this schema — SQL + actual results)');

// Shared subquery fragment: pulls the archaic/rare/obsolete/obscure tags
// actually present on an entry's senses (via json_each unnesting the JSON
// array interned in tag_lists and referenced by entry_senses.misc_id), so
// example results show the specific label PLAN.md's Phase 1 UI would render
// ("archaic", "rare", etc.), not just the coarse is_archaic boolean.
const LABELS_SUBQUERY = `(
  SELECT GROUP_CONCAT(DISTINCT m.value) FROM entry_senses s
  JOIN tag_lists tl ON tl.id = s.misc_id, json_each(tl.json) m
  WHERE s.entry_id = e.id AND m.value IN ('arch', 'obs', 'rare', 'obsc')
) AS labels`;

runExample(
  // Substring LIKE-scan, same approach src/dictionary/search.js uses on
  // every driver. A plain substring match for "cat" also matches idioms
  // like "scaredy-cat" (an entry meaning "coward") — a correct match on the
  // indexed text, not a bug, but it shows why Phase 1's tiered matching
  // (PLAN.md) needs to rank an exact gloss match above a match that's just
  // a substring of a longer idiom.
  'Search by English gloss, common-first ("cat")',
  `SELECT e.id, GROUP_CONCAT(DISTINCT k.text) AS kanji, GROUP_CONCAT(DISTINCT r.text) AS readings,
          GROUP_CONCAT(DISTINCT g.text) AS glosses, e.commonness_score, e.is_archaic, ${LABELS_SUBQUERY}
   FROM entries e
   LEFT JOIN entry_kanji k ON k.entry_id = e.id
   JOIN entry_readings r ON r.entry_id = e.id
   JOIN entry_glosses g ON g.entry_id = e.id
   WHERE e.id IN (SELECT entry_id FROM entry_glosses WHERE text LIKE '%cat%')
   GROUP BY e.id ORDER BY e.commonness_score DESC LIMIT 5`,
);

runExample(
  'Search by kana reading ("ねこ")',
  `SELECT e.id, GROUP_CONCAT(DISTINCT k.text) AS kanji, GROUP_CONCAT(DISTINCT r.text) AS readings,
          GROUP_CONCAT(DISTINCT g.text) AS glosses, e.commonness_score, e.is_archaic, ${LABELS_SUBQUERY}
   FROM entries e
   LEFT JOIN entry_kanji k ON k.entry_id = e.id
   JOIN entry_readings r ON r.entry_id = e.id
   JOIN entry_glosses g ON g.entry_id = e.id
   WHERE e.id IN (SELECT entry_id FROM entry_readings WHERE text LIKE '%ねこ%')
   GROUP BY e.id ORDER BY e.commonness_score DESC LIMIT 5`,
);

runExample(
  'Kanji-count filter: single-kanji headwords, most common first',
  `SELECT e.id, k.text AS headword, GROUP_CONCAT(DISTINCT g.text) AS glosses, e.commonness_score,
          e.is_archaic, ${LABELS_SUBQUERY}
   FROM entries e
   JOIN entry_kanji k ON k.entry_id = e.id AND k.ord = 0
   JOIN entry_glosses g ON g.entry_id = e.id
   WHERE e.kanji_count = 1 GROUP BY e.id ORDER BY e.commonness_score DESC LIMIT 5`,
);

runExample(
  'Archaic/rare labeling: a few is_archaic entries, with the specific tag(s)',
  `SELECT e.id, k.text AS headword, r.text AS reading, GROUP_CONCAT(DISTINCT g.text) AS glosses,
          ${LABELS_SUBQUERY}
   FROM entries e
   LEFT JOIN entry_kanji k ON k.entry_id = e.id AND k.ord = 0
   JOIN entry_readings r ON r.entry_id = e.id AND r.ord = 0
   JOIN entry_glosses g ON g.entry_id = e.id
   WHERE e.is_archaic = 1 GROUP BY e.id LIMIT 5`,
);

runExample(
  'Kanji detail (水)',
  `SELECT literal, onyomi, kunyomi, meanings, stroke_count, radical_number FROM kanji WHERE literal = '水'`,
);

runExample(
  'Kanji compounds, common-first (水)',
  `SELECT kc.entry_id, kc.score,
          (SELECT text FROM entry_kanji WHERE entry_id = kc.entry_id ORDER BY ord LIMIT 1) AS headword
   FROM kanji_compounds kc WHERE kc.kanji = '水' ORDER BY kc.score DESC LIMIT 5`,
);

const sentenceExample = runExample(
  'Example sentence + furigana for an entry containing 水',
  `SELECT s.japanese, s.english, s.furigana
   FROM entry_sentences es
   JOIN sentences s ON s.id = es.sentence_id
   WHERE es.entry_id IN (SELECT entry_id FROM kanji_compounds WHERE kanji = '水' ORDER BY score DESC LIMIT 1)
   LIMIT 1`,
);
if (sentenceExample[0]) {
  console.log('furigana tokens:', JSON.parse(sentenceExample[0].furigana));
}

db.close();

console.log(`\n${failures === 0 ? '\x1b[32mAll checks passed.\x1b[0m' : `\x1b[31m${failures} check(s) failed.\x1b[0m`}`);
process.exit(failures === 0 ? 0 : 1);
