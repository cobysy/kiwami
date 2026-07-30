// Tatoeba example sentences for a single entry (see schema in
// scripts/assemble-sqlite.mjs: sentences carries furigana tokens inline,
// entry_sentences is the join table, capped at
// scripts/build-sentences.mjs's MAX_SENTENCES_PER_ENTRY per entry at build
// time, shortest-first).
//
// furigana is stored as a delimited string ({ surface, reading }[], reading
// null for tokens with no kanji - see scripts/build-furigana.mjs and
// scripts/assemble-sqlite.mjs's encodeFurigana), decoded here so callers get
// it ready to render as ruby.
import { decodeFurigana } from './list-encoding.js';

/**
 * @param {import('./sqlite-driver.js').DBDriver} driver
 * @param {number} entryId
 * @returns {Promise<Array<{ id: number, japanese: string, japaneseAuthor: string|null, english: string, englishAuthor: string|null, furigana: Array<{ surface: string, reading: string|null }> }>>}
 */
export async function fetchSentencesForEntry(driver, entryId) {
  const rows = await driver.all(
    `SELECT s.id, s.japanese, s.japanese_author, s.english, s.english_author, s.furigana
     FROM entry_sentences es JOIN sentences s ON s.id = es.sentence_id
     WHERE es.entry_id = ?`,
    [entryId],
  );
  return rows.map((row) => ({
    id: row.id,
    japanese: row.japanese,
    japaneseAuthor: row.japanese_author,
    english: row.english,
    englishAuthor: row.english_author,
    furigana: decodeFurigana(row.furigana),
  }));
}
