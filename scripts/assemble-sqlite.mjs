// npm run build:db -- db  (one stage of the dispatcher in scripts/build-db.sh;
// see that file for the full fetch+build step list)
//
// Assembles all Phase 0 build artifacts into the single SQLite file that
// ships with the app (loaded via sql.js at runtime — see PLAN.md's decision
// to use sql.js over wa-sqlite). Reads:
//   data/build/entries.ndjson          (npm run build:db -- entries)
//   data/build/kanji.ndjson            (npm run build:db -- kanji)
//   data/build/sentences.ndjson        (npm run build:db -- sentences)
//   data/build/entry_sentences.ndjson  (npm run build:db -- sentences)
//   data/build/furigana.ndjson         (npm run build:db -- furigana)
//   data/build/kanji_compounds.ndjson  (npm run build:db -- compounds)
//
// Schema: entries/entry_kanji/entry_readings/entry_senses/entry_glosses
// normalize JMdict; kanji holds KANJIDIC2; kanji_compounds and
// entry_sentences are join tables; sentences carries furigana tokens inline
// (1:1 with a sentence, no separate table needed). `meta` holds build info
// and license attribution text (per-sentence author credit lives on the
// sentence row itself, since Tatoeba's CC BY 2.0 FR requires crediting the
// individual contributor, not just "Tatoeba" generically).
//
// No table for "visually confusable kanji" (PLAN.md Phase 0) — that feature
// was dropped for now rather than shipped from a hand-authored, unsourced
// list. Revisit with a real source (e.g. KanjiVG stroke/component structural
// similarity) before adding it back.
//
// Output: data/build/dictionary.db — an intermediate build artifact (like
// the rest of data/build/, gitignored), not something shipped directly.
// Node-side tooling reads it straight off disk (tests/node/dictionary.test.js,
// scripts/verify-db.mjs, scripts/screenshot.mjs). What actually ships to
// public/ — and is what's tracked in git and fetched at runtime — is
// public/dictionary.db.zip, produced from this file by `npm run build:db --
// zip` (scripts/zip-db.mjs); `npm run setup:db` (scripts/unzip-db.mjs, wired
// into `postinstall`) extracts this file back out of that zip on a fresh
// clone, so resuming dev still needs no network access despite rebuilding
// from source needing three external hosts and a couple of minutes. Kept
// out of public/ specifically so `vite build`'s publicDir copy never ships
// this uncompressed 134MB copy alongside the 49MB zip nothing in the
// browser bundle references anymore. Zip entries are still named `dictionary.db`
// rather than `.sqlite`: jeep-sqlite's HTTP-import path picks its strategy
// from the URL's file extension and only recognizes `.db`/`.zip` (see
// `ensureDatabaseFromUrl` in src/dictionary/sqlite-drivers/browser-sqlite-driver.js).

import { createReadStream, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = path.join(__dirname, '../data/build');
const OUT_FILE = path.join(BUILD_DIR, 'dictionary.db');

// node:sqlite has no built-in `db.transaction()` helper (unlike
// better-sqlite3) — wrap BEGIN/COMMIT/ROLLBACK by hand.
function makeTransaction(db, fn) {
  return (arg) => {
    db.exec('BEGIN');
    try {
      fn(arg);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
}

// Caches JSON-array tag lists by their serialized text so each distinct
// value is inserted into tag_lists exactly once; repeat callers get the
// cached id back from the Map with no extra SQL round trip. `value` of
// `null`/`undefined` is passed through as `null` (a real "no restriction"
// state, distinct from an interned empty array) rather than interned.
function makeInterner(db) {
  const cache = new Map();
  const insert = db.prepare('INSERT INTO tag_lists (json) VALUES (?)');
  return (value) => {
    if (value == null) return null;
    const json = JSON.stringify(value);
    let id = cache.get(json);
    if (id === undefined) {
      id = Number(insert.run(json).lastInsertRowid);
      cache.set(json, id);
    }
    return id;
  };
}

function readNdjson(file) {
  return createInterface({
    input: createReadStream(path.join(BUILD_DIR, file), { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
}

const SCHEMA = `
CREATE TABLE entries (
  id INTEGER PRIMARY KEY,
  kanji_count INTEGER NOT NULL,
  commonness_score REAL NOT NULL,
  is_archaic INTEGER NOT NULL
);

-- Interned JSON-array tag lists (ke_inf/ke_pri/re_inf/re_pri/pos/field/misc/
-- dial/antonym/stagk/stagr all take this shape), and the vast majority of
-- rows across entry_kanji/entry_readings/entry_senses share one of a few
-- hundred distinct values, e.g. "[]" or ["news1","ichi1"] - storing one copy
-- here and referencing it by id instead of repeating the JSON text on every
-- row cuts a large fraction of those tables' size. re_restr/xref are NOT
-- interned here despite the same JSON-array shape: measured against the
-- built db, re_restr is ~96% unique values (4570/4782 non-null rows) and
-- xref ~12% unique (29203/252681 rows) - each is closer to free text
-- referencing specific other headwords than a small reusable tag set, so
-- interning them would add a join+id column for essentially no dedup.
CREATE TABLE tag_lists (
  id INTEGER PRIMARY KEY,
  json TEXT UNIQUE NOT NULL
);

CREATE TABLE entry_kanji (
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  info_id INTEGER NOT NULL REFERENCES tag_lists(id),
  priority_id INTEGER NOT NULL REFERENCES tag_lists(id)
);
CREATE INDEX idx_entry_kanji_text ON entry_kanji(text);
CREATE INDEX idx_entry_kanji_entry ON entry_kanji(entry_id);

CREATE TABLE entry_readings (
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  no_kanji INTEGER NOT NULL,
  restrict_to TEXT,
  info_id INTEGER NOT NULL REFERENCES tag_lists(id),
  priority_id INTEGER NOT NULL REFERENCES tag_lists(id)
);
CREATE INDEX idx_entry_readings_text ON entry_readings(text);
CREATE INDEX idx_entry_readings_entry ON entry_readings(entry_id);

CREATE TABLE entry_senses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  ord INTEGER NOT NULL,
  pos_id INTEGER NOT NULL REFERENCES tag_lists(id),
  field_id INTEGER NOT NULL REFERENCES tag_lists(id),
  misc_id INTEGER NOT NULL REFERENCES tag_lists(id),
  dial_id INTEGER NOT NULL REFERENCES tag_lists(id),
  xref TEXT NOT NULL,
  antonym_id INTEGER NOT NULL REFERENCES tag_lists(id),
  info TEXT,
  restrict_to_kanji_id INTEGER REFERENCES tag_lists(id),
  restrict_to_reading_id INTEGER REFERENCES tag_lists(id)
);
CREATE INDEX idx_entry_senses_entry ON entry_senses(entry_id);

-- COLLATE NOCASE lets a plain \`text = ?\` / \`text LIKE 'foo%'\` use
-- idx_entry_glosses_text case-insensitively, matching how entry_kanji/
-- entry_readings' plain-BINARY indexes are already used - without it, the
-- old \`LOWER(text) = LOWER(?)\` exact-match query couldn't use any index and
-- fell back to a full scan of this table on every search.
CREATE TABLE entry_glosses (
  sense_id INTEGER NOT NULL REFERENCES entry_senses(id),
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  ord INTEGER NOT NULL,
  text TEXT NOT NULL COLLATE NOCASE
);
CREATE INDEX idx_entry_glosses_text ON entry_glosses(text);
CREATE INDEX idx_entry_glosses_sense ON entry_glosses(sense_id);
CREATE INDEX idx_entry_glosses_entry ON entry_glosses(entry_id);

CREATE TABLE kanji (
  literal TEXT PRIMARY KEY,
  onyomi TEXT NOT NULL,
  kunyomi TEXT NOT NULL,
  meanings TEXT NOT NULL,
  stroke_count INTEGER,
  grade INTEGER,
  jlpt INTEGER,
  frequency INTEGER,
  radical_number INTEGER
);

CREATE TABLE kanji_compounds (
  kanji TEXT NOT NULL REFERENCES kanji(literal),
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  score REAL NOT NULL
);
CREATE INDEX idx_kanji_compounds_kanji ON kanji_compounds(kanji);

CREATE TABLE sentences (
  id INTEGER PRIMARY KEY,
  japanese TEXT NOT NULL,
  japanese_author TEXT,
  english TEXT NOT NULL,
  english_author TEXT,
  furigana TEXT NOT NULL
);

CREATE TABLE entry_sentences (
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  sentence_id INTEGER NOT NULL REFERENCES sentences(id)
);
CREATE INDEX idx_entry_sentences_entry ON entry_sentences(entry_id);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

async function main() {
  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  if (existsSync(OUT_FILE)) rmSync(OUT_FILE);

  const db = new DatabaseSync(OUT_FILE);
  db.exec('PRAGMA journal_mode = OFF');
  db.exec('PRAGMA synchronous = OFF');
  db.exec(SCHEMA);

  console.log('Loading kanji...');
  {
    const insert = db.prepare(`INSERT INTO kanji
      (literal, onyomi, kunyomi, meanings, stroke_count, grade, jlpt, frequency, radical_number)
      VALUES (@literal, @onyomi, @kunyomi, @meanings, @strokeCount, @grade, @jlpt, @frequency, @radicalNumber)`);
    const insertMany = makeTransaction(db, (rows) => { for (const r of rows) insert.run(r); });
    const batch = [];
    for await (const line of readNdjson('kanji.ndjson')) {
      if (!line) continue;
      const k = JSON.parse(line);
      batch.push({
        literal: k.literal,
        onyomi: JSON.stringify(k.onyomi),
        kunyomi: JSON.stringify(k.kunyomi),
        meanings: JSON.stringify(k.meanings),
        strokeCount: k.strokeCount,
        grade: k.grade,
        jlpt: k.jlpt,
        frequency: k.frequency,
        radicalNumber: k.radicalNumber,
      });
    }
    insertMany(batch);
    console.log(`  ${batch.length} kanji.`);
  }

  console.log('Loading entries (+ kanji forms, readings, senses, glosses)...');
  {
    const intern = makeInterner(db);
    const insertEntry = db.prepare('INSERT INTO entries (id, kanji_count, commonness_score, is_archaic) VALUES (?, ?, ?, ?)');
    const insertKanji = db.prepare('INSERT INTO entry_kanji (entry_id, ord, text, info_id, priority_id) VALUES (?, ?, ?, ?, ?)');
    const insertReading = db.prepare('INSERT INTO entry_readings (entry_id, ord, text, no_kanji, restrict_to, info_id, priority_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insertSense = db.prepare(`INSERT INTO entry_senses
      (entry_id, ord, pos_id, field_id, misc_id, dial_id, xref, antonym_id, info, restrict_to_kanji_id, restrict_to_reading_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertGloss = db.prepare('INSERT INTO entry_glosses (sense_id, entry_id, ord, text) VALUES (?, ?, ?, ?)');

    const insertEntryTx = makeTransaction(db, (e) => {
      insertEntry.run(e.id, e.kanjiCount, e.commonnessScore, e.isArchaic ? 1 : 0);
      e.kanji.forEach((k, i) => insertKanji.run(e.id, i, k.text, intern(k.info), intern(k.priority)));
      e.readings.forEach((r, i) => insertReading.run(
        e.id, i, r.text, r.noKanji ? 1 : 0,
        r.restrictTo ? JSON.stringify(r.restrictTo) : null,
        intern(r.info), intern(r.priority),
      ));
      e.senses.forEach((s, i) => {
        const senseId = insertSense.run(
          e.id, i, intern(s.pos), intern(s.field), intern(s.misc), intern(s.dial),
          JSON.stringify(s.xref), intern(s.antonym), s.info,
          intern(s.restrictToKanji),
          intern(s.restrictToReading),
        ).lastInsertRowid;
        s.glosses.forEach((g, gi) => insertGloss.run(senseId, e.id, gi, g));
      });
    });

    let count = 0;
    for await (const line of readNdjson('entries.ndjson')) {
      if (!line) continue;
      insertEntryTx(JSON.parse(line));
      count++;
      if (count % 50000 === 0) console.log(`  ${count} entries...`);
    }
    console.log(`  ${count} entries.`);
  }

  console.log('Loading kanji_compounds...');
  {
    const insert = db.prepare('INSERT INTO kanji_compounds (kanji, entry_id, score) VALUES (?, ?, ?)');
    const insertMany = makeTransaction(db, (rows) => { for (const r of rows) insert.run(r.kanji, r.entryId, r.score); });
    const batch = [];
    for await (const line of readNdjson('kanji_compounds.ndjson')) {
      if (!line) continue;
      batch.push(JSON.parse(line));
    }
    insertMany(batch);
    console.log(`  ${batch.length} kanji_compounds rows.`);
  }

  console.log('Loading sentences (+ furigana)...');
  {
    const furigana = new Map();
    for await (const line of readNdjson('furigana.ndjson')) {
      if (!line) continue;
      const f = JSON.parse(line);
      furigana.set(f.id, f.tokens);
    }

    const insert = db.prepare(`INSERT INTO sentences
      (id, japanese, japanese_author, english, english_author, furigana)
      VALUES (@id, @japanese, @japaneseAuthor, @english, @englishAuthor, @furigana)`);
    const insertMany = makeTransaction(db, (rows) => { for (const r of rows) insert.run(r); });
    const batch = [];
    for await (const line of readNdjson('sentences.ndjson')) {
      if (!line) continue;
      const s = JSON.parse(line);
      batch.push({
        id: s.id,
        japanese: s.japanese,
        japaneseAuthor: s.japaneseAuthor,
        english: s.english,
        englishAuthor: s.englishAuthor,
        furigana: JSON.stringify(furigana.get(s.id) || []),
      });
    }
    insertMany(batch);
    console.log(`  ${batch.length} sentences.`);
  }

  console.log('Loading entry_sentences...');
  {
    const insert = db.prepare('INSERT INTO entry_sentences (entry_id, sentence_id) VALUES (?, ?)');
    const insertMany = makeTransaction(db, (rows) => { for (const r of rows) insert.run(r.entryId, r.sentenceId); });
    const batch = [];
    for await (const line of readNdjson('entry_sentences.ndjson')) {
      if (!line) continue;
      batch.push(JSON.parse(line));
    }
    insertMany(batch);
    console.log(`  ${batch.length} entry_sentences rows.`);
  }

  console.log('Writing meta...');
  {
    const insert = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    insert.run('jmdict_kanjidic_license', 'CC BY-SA 4.0');
    insert.run('jmdict_kanjidic_attribution',
      'This application uses the JMdict and KANJIDIC2 dictionary files, property of the Electronic '
      + 'Dictionary Research and Development Group (https://www.edrdg.org/), used in conformance with '
      + "the Group's licence (CC BY-SA 4.0).");
    insert.run('tatoeba_license', 'CC BY 2.0 FR');
    insert.run('tatoeba_attribution',
      'Example sentences are from the Tatoeba Project (https://tatoeba.org), used and distributed under '
      + 'CC BY 2.0 FR. Each sentence is individually credited to its contributor — see the '
      + 'japanese_author/english_author columns on the sentences table.');
  }

  console.log('Optimizing...');
  db.exec('PRAGMA optimize');
  db.close();

  console.log(`Done: ${OUT_FILE}`);
}

main();
