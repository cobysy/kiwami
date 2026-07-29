// Shared entry-hydration helper used by every query module: given a set of
// `entries.id` values, fetch the full display data (headword/reading/gloss
// lists, commonness, archaic flag + specific tag labels) sorted the way
// PLAN.md's Phase 1 tiered-match spec describes — common-first within a
// tier, archaic pushed down rather than filtered out.

// Pulls the archaic/rare/obsolete/obscure tags actually present on an
// entry's senses (same pattern verify-db.mjs's example queries use), so
// callers get the specific label ("arch", "rare", ...) instead of just the
// coarse `is_archaic` boolean.
const LABELS_SUBQUERY = `(
  SELECT GROUP_CONCAT(DISTINCT m.value) FROM entry_senses s, json_each(s.misc) m
  WHERE s.entry_id = e.id AND m.value IN ('arch', 'obs', 'rare', 'obsc')
) AS labels`;

/**
 * @param {import('../driver.js').DBDriver} driver
 * @param {Iterable<number>} entryIds
 * @param {{ limit?: number }} [options]
 * @returns {Promise<Array<object>>}
 */
export async function fetchEntriesByIds(driver, entryIds, options = {}) {
  const ids = [...new Set(entryIds)];
  if (ids.length === 0) return [];
  const limit = options.limit ?? 50;

  const placeholders = ids.map(() => '?').join(',');
  const rows = await driver.all(
    `SELECT e.id, e.kanji_count, e.commonness_score, e.is_archaic, ${LABELS_SUBQUERY}
     FROM entries e
     WHERE e.id IN (${placeholders})
     ORDER BY e.is_archaic ASC, e.commonness_score DESC
     LIMIT ?`,
    [...ids, limit],
  );

  for (const row of rows) {
    const [kanji, readings, glosses] = await Promise.all([
      driver.all('SELECT text FROM entry_kanji WHERE entry_id = ? ORDER BY ord', [row.id]),
      driver.all('SELECT text FROM entry_readings WHERE entry_id = ? ORDER BY ord', [row.id]),
      driver.all('SELECT text FROM entry_glosses WHERE entry_id = ? ORDER BY ord', [row.id]),
    ]);
    row.kanji = kanji.map((r) => r.text);
    row.readings = readings.map((r) => r.text);
    row.glosses = glosses.map((r) => r.text);
    row.archaic = row.is_archaic === 1;
    row.labels = row.labels ? row.labels.split(',') : [];
    delete row.is_archaic;
  }
  return rows;
}
