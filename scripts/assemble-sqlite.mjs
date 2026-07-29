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
// Output: public/dictionary.db — tracked in git (not gitignored like the
// rest of data/build/), since rebuilding it needs network access to three
// external hosts and takes a couple of minutes; committing it means a fresh
// clone/machine doesn't need to run the fetch+build pipeline just to resume
// dev. It also lives in public/ specifically because that's where Phase 1's
// Vite app will need it — sql.js fetches it at runtime as a static asset.
// Named `.db` rather than `.sqlite`: jeep-sqlite's HTTP-import path picks its
// strategy from the URL's file extension and only recognizes `.db`/`.zip`
// (see `ensureDatabaseFromUrl` in src/dictionary/sqlite-drivers/browser-sqlite-driver.js), so this
// is the name the dev harness's "load real dictionary" button needs — no
// separate symlink/rename step required.

import { createReadStream, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = path.join(__dirname, '../data/build');
const OUT_FILE = path.join(__dirname, '../public/dictionary.db');

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

CREATE TABLE entry_kanji (
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  info TEXT NOT NULL,
  priority TEXT NOT NULL
);
CREATE INDEX idx_entry_kanji_text ON entry_kanji(text);
CREATE INDEX idx_entry_kanji_entry ON entry_kanji(entry_id);

CREATE TABLE entry_readings (
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  no_kanji INTEGER NOT NULL,
  restrict_to TEXT,
  info TEXT NOT NULL,
  priority TEXT NOT NULL
);
CREATE INDEX idx_entry_readings_text ON entry_readings(text);
CREATE INDEX idx_entry_readings_entry ON entry_readings(entry_id);

CREATE TABLE entry_senses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  ord INTEGER NOT NULL,
  pos TEXT NOT NULL,
  field TEXT NOT NULL,
  misc TEXT NOT NULL,
  dial TEXT NOT NULL,
  xref TEXT NOT NULL,
  antonym TEXT NOT NULL,
  info TEXT,
  restrict_to_kanji TEXT,
  restrict_to_reading TEXT
);
CREATE INDEX idx_entry_senses_entry ON entry_senses(entry_id);

CREATE TABLE entry_glosses (
  sense_id INTEGER NOT NULL REFERENCES entry_senses(id),
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  ord INTEGER NOT NULL,
  text TEXT NOT NULL
);
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
    const insertEntry = db.prepare('INSERT INTO entries (id, kanji_count, commonness_score, is_archaic) VALUES (?, ?, ?, ?)');
    const insertKanji = db.prepare('INSERT INTO entry_kanji (entry_id, ord, text, info, priority) VALUES (?, ?, ?, ?, ?)');
    const insertReading = db.prepare('INSERT INTO entry_readings (entry_id, ord, text, no_kanji, restrict_to, info, priority) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insertSense = db.prepare(`INSERT INTO entry_senses
      (entry_id, ord, pos, field, misc, dial, xref, antonym, info, restrict_to_kanji, restrict_to_reading)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertGloss = db.prepare('INSERT INTO entry_glosses (sense_id, entry_id, ord, text) VALUES (?, ?, ?, ?)');

    const insertEntryTx = makeTransaction(db, (e) => {
      insertEntry.run(e.id, e.kanjiCount, e.commonnessScore, e.isArchaic ? 1 : 0);
      e.kanji.forEach((k, i) => insertKanji.run(e.id, i, k.text, JSON.stringify(k.info), JSON.stringify(k.priority)));
      e.readings.forEach((r, i) => insertReading.run(
        e.id, i, r.text, r.noKanji ? 1 : 0,
        r.restrictTo ? JSON.stringify(r.restrictTo) : null,
        JSON.stringify(r.info), JSON.stringify(r.priority),
      ));
      e.senses.forEach((s, i) => {
        const senseId = insertSense.run(
          e.id, i, JSON.stringify(s.pos), JSON.stringify(s.field), JSON.stringify(s.misc), JSON.stringify(s.dial),
          JSON.stringify(s.xref), JSON.stringify(s.antonym), s.info,
          s.restrictToKanji ? JSON.stringify(s.restrictToKanji) : null,
          s.restrictToReading ? JSON.stringify(s.restrictToReading) : null,
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
