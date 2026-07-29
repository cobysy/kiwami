// Small, handpicked fixture dataset covering every Phase 1 query-layer
// behaviour end to end (tiered match, wildcards, kanji-count facet, archaic
// tagging, kanji + compounds, sentence + furigana join, deconjugation
// candidates) without touching the real 164MB public/dictionary.db —
// that file is fine for the Node driver (a real file-backed engine) but
// would be far too slow to load into every browser test run, since the
// jeep-sqlite/sql.js fallback keeps the whole database in WASM memory.
//
// Seeded through the driver interface itself (`exec` for schema, `run` for
// inserts), so building this fixture doubles as coverage for both those
// methods, not just `all`.
import { SCHEMA_SQL } from './schema.js';

const ENTRIES = [
  // id, kanjiCount, commonness, isArchaic, kanji[], readings[], glosses[], pos[], misc[]
  { id: 1, kanjiCount: 1, commonness: 80, archaic: false, kanji: ['食べる'], readings: ['たべる'], glosses: ['to eat'], pos: ['v1'] },
  { id: 2, kanjiCount: 1, commonness: 75, archaic: false, kanji: ['書く'], readings: ['かく'], glosses: ['to write'], pos: ['v5k'] },
  { id: 3, kanjiCount: 1, commonness: 70, archaic: false, kanji: ['高い'], readings: ['たかい'], glosses: ['expensive', 'tall'], pos: ['adj-i'] },
  { id: 4, kanjiCount: 1, commonness: 90, archaic: false, kanji: ['水'], readings: ['みず'], glosses: ['water'], pos: ['n'] },
  { id: 5, kanjiCount: 2, commonness: 40, archaic: false, kanji: ['明白'], readings: ['めいはく'], glosses: ['obvious', 'clear'], pos: ['adj-na'] },
  { id: 6, kanjiCount: 1, commonness: 1, archaic: true, kanji: ['汝'], readings: ['なんじ'], glosses: ['thou'], pos: ['pn'], misc: ['arch'] },
  { id: 7, kanjiCount: 1, commonness: 85, archaic: false, kanji: ['猫'], readings: ['ねこ'], glosses: ['cat'], pos: ['n'] },
  { id: 8, kanjiCount: 0, commonness: 60, archaic: false, kanji: [], readings: ['おばさん'], glosses: ['aunt', 'middle-aged woman'], pos: ['n'] },
  { id: 9, kanjiCount: 0, commonness: 60, archaic: false, kanji: [], readings: ['おばあさん'], glosses: ['grandmother', 'old woman'], pos: ['n'] },
  { id: 10, kanjiCount: 4, commonness: 30, archaic: false, kanji: ['一石二鳥'], readings: ['いっせきにちょう'], glosses: ['killing two birds with one stone'], pos: ['exp'] },
  { id: 11, kanjiCount: 1, commonness: 65, archaic: false, kanji: ['飲む'], readings: ['のむ'], glosses: ['to drink'], pos: ['v5m'] },
];

const KANJI = [
  { literal: '水', onyomi: ['スイ'], kunyomi: ['みず'], meanings: ['water'], strokeCount: 4, grade: 1, jlpt: 8, frequency: 34, radicalNumber: 85 },
];

const KANJI_COMPOUNDS = [{ kanji: '水', entryId: 4, score: 100 }];

const SENTENCES = [
  {
    id: 1,
    japanese: '彼はりんごを食べた。',
    japaneseAuthor: 'test_fixture',
    english: 'He ate an apple.',
    englishAuthor: 'test_fixture',
    furigana: [
      { surface: '彼', reading: 'かれ' },
      { surface: 'は', reading: null },
      { surface: 'りんご', reading: null },
      { surface: 'を', reading: null },
      { surface: '食べた', reading: 'たべた' },
    ],
    entryId: 1,
  },
];

/** @param {import('../../src/db/driver.js').DBDriver} driver */
export async function seedFixtureDb(driver) {
  await driver.exec(SCHEMA_SQL);

  for (const entry of ENTRIES) {
    await driver.run('INSERT INTO entries (id, kanji_count, commonness_score, is_archaic) VALUES (?, ?, ?, ?)', [
      entry.id,
      entry.kanjiCount,
      entry.commonness,
      entry.archaic ? 1 : 0,
    ]);

    for (let ord = 0; ord < entry.kanji.length; ord++) {
      await driver.run('INSERT INTO entry_kanji (entry_id, ord, text, info, priority) VALUES (?, ?, ?, ?, ?)', [
        entry.id, ord, entry.kanji[ord], '[]', '[]',
      ]);
    }

    for (let ord = 0; ord < entry.readings.length; ord++) {
      await driver.run(
        'INSERT INTO entry_readings (entry_id, ord, text, no_kanji, restrict_to, info, priority) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [entry.id, ord, entry.readings[ord], entry.kanji.length === 0 ? 1 : 0, null, '[]', '[]'],
      );
    }

    const { lastInsertRowid: senseId } = await driver.run(
      'INSERT INTO entry_senses (entry_id, ord, pos, field, misc, dial, xref, antonym, info, restrict_to_kanji, restrict_to_reading) VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [entry.id, JSON.stringify(entry.pos), '[]', JSON.stringify(entry.misc ?? []), '[]', '[]', '[]', null, null, null],
    );

    for (let ord = 0; ord < entry.glosses.length; ord++) {
      await driver.run('INSERT INTO entry_glosses (sense_id, entry_id, ord, text) VALUES (?, ?, ?, ?)', [
        senseId, entry.id, ord, entry.glosses[ord],
      ]);
    }
  }

  for (const k of KANJI) {
    await driver.run(
      `INSERT INTO kanji (literal, onyomi, kunyomi, meanings, stroke_count, grade, jlpt, frequency, radical_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [k.literal, JSON.stringify(k.onyomi), JSON.stringify(k.kunyomi), JSON.stringify(k.meanings), k.strokeCount, k.grade, k.jlpt, k.frequency, k.radicalNumber],
    );
  }
  for (const c of KANJI_COMPOUNDS) {
    await driver.run('INSERT INTO kanji_compounds (kanji, entry_id, score) VALUES (?, ?, ?)', [c.kanji, c.entryId, c.score]);
  }
  for (const s of SENTENCES) {
    await driver.run(
      'INSERT INTO sentences (id, japanese, japanese_author, english, english_author, furigana) VALUES (?, ?, ?, ?, ?, ?)',
      [s.id, s.japanese, s.japaneseAuthor, s.english, s.englishAuthor, JSON.stringify(s.furigana)],
    );
    await driver.run('INSERT INTO entry_sentences (entry_id, sentence_id) VALUES (?, ?)', [s.entryId, s.id]);
  }
}
