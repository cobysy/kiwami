// Per-character kanji breakdown (stroke count + on'yomi/kun'yomi) for a
// result card's kanji headword, pulled from the `kanji` table built by
// scripts/build-kanji.mjs. onyomi/kunyomi are stored as delimited strings
// (see scripts/assemble-sqlite.mjs's encodeList), decoded here for the caller.
import { hasKanji } from './kanji.js';
import { decodeList } from './list-encoding.js';

/**
 * @param {import('./sqlite-driver.js').DBDriver} driver
 * @param {string} headword - a kanji or kanji+kana headword; non-kanji
 *   characters (okurigana) are ignored
 * @returns {Promise<Array<{ literal: string, onyomi: string[], kunyomi: string[], strokeCount: number|null }>>}
 */
export async function fetchKanjiDetails(driver, headword) {
  const literals = [...new Set([...(headword ?? '')].filter(hasKanji))];
  if (literals.length === 0) return [];

  const placeholders = literals.map(() => '?').join(',');
  const rows = await driver.all(
    `SELECT literal, onyomi, kunyomi, stroke_count FROM kanji WHERE literal IN (${placeholders})`,
    literals,
  );
  const byLiteral = new Map(rows.map((r) => [r.literal, r]));

  return literals
    .filter((l) => byLiteral.has(l))
    .map((l) => {
      const row = byLiteral.get(l);
      return {
        literal: l,
        onyomi: decodeList(row.onyomi),
        kunyomi: decodeList(row.kunyomi),
        strokeCount: row.stroke_count,
      };
    });
}
