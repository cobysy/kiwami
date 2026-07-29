// Shared entry-hydration helper used by every query module: given a set of
// `entries.id` values, fetch the full display data (headword/reading/gloss
// lists, commonness, archaic flag + specific tag labels, part of speech)
// sorted the way PLAN.md's Phase 1 tiered-match spec describes —
// common-first within a tier, archaic pushed down rather than filtered out.
import { dialectLabel } from './dialect-labels.js';

// Pulls the archaic/rare/obsolete/obscure tags actually present on an
// entry's senses (same pattern verify-db.mjs's example queries use), so
// callers get the specific label ("arch", "rare", ...) instead of just the
// coarse `is_archaic` boolean.
// misc/dial/priority are interned into tag_lists (see assemble-sqlite.mjs)
// rather than storing the JSON array inline on every row, so each subquery
// joins to tag_lists to get the JSON text back before unnesting it.
const LABELS_SUBQUERY = `(
  SELECT GROUP_CONCAT(DISTINCT m.value) FROM entry_senses s
  JOIN tag_lists tl ON tl.id = s.misc_id, json_each(tl.json) m
  WHERE s.entry_id = e.id AND m.value IN ('arch', 'obs', 'rare', 'obsc')
) AS labels`;

// Same GROUP_CONCAT-across-senses pattern as LABELS_SUBQUERY, but for
// entry_senses.dial (regional dialect tags, e.g. ksb/Kansai-ben) so results
// can show which entries are dialect-specific.
const DIALECT_SUBQUERY = `(
  SELECT GROUP_CONCAT(DISTINCT dialect_tag.value) FROM entry_senses s
  JOIN tag_lists tl ON tl.id = s.dial_id, json_each(tl.json) dialect_tag
  WHERE s.entry_id = e.id
) AS dialect`;

// Raw ke_pri/re_pri tags (news1, ichi1, nf12, ...) behind commonness_score -
// see frequency-labels.js for what each tag means. Pulled from both
// entry_kanji and entry_readings since either can carry priority tags.
const PRIORITY_SUBQUERY = `(
  SELECT GROUP_CONCAT(DISTINCT tag) FROM (
    SELECT priority_tag.value AS tag FROM entry_kanji k
    JOIN tag_lists tl ON tl.id = k.priority_id, json_each(tl.json) priority_tag WHERE k.entry_id = e.id
    UNION
    SELECT priority_tag.value AS tag FROM entry_readings r
    JOIN tag_lists tl ON tl.id = r.priority_id, json_each(tl.json) priority_tag WHERE r.entry_id = e.id
  )
) AS priority`;

/**
 * @param {import('./sqlite-driver.js').DBDriver} driver
 * @param {Iterable<number>} entryIds
 * @param {{ limit?: number }} [options]
 * @returns {Promise<Array<object>>}
 */
export async function fetchEntriesByIds(driver, entryIds, options = {}) {
  const ids = [...new Set(entryIds)];
  if (ids.length === 0) return [];
  const limit = options.limit ?? 100;

  const placeholders = ids.map(() => '?').join(',');
  const rows = await driver.all(
    `SELECT e.id, e.kanji_count, e.commonness_score, e.is_archaic, ${LABELS_SUBQUERY}, ${DIALECT_SUBQUERY}, ${PRIORITY_SUBQUERY}
     FROM entries e
     WHERE e.id IN (${placeholders})
     ORDER BY e.is_archaic ASC, e.commonness_score DESC
     LIMIT ?`,
    [...ids, limit],
  );

  await Promise.all(rows.map(async (row) => {
    const [kanji, readings, glosses, senses] = await Promise.all([
      driver.all('SELECT text FROM entry_kanji WHERE entry_id = ? ORDER BY ord', [row.id]),
      driver.all('SELECT text FROM entry_readings WHERE entry_id = ? ORDER BY ord', [row.id]),
      driver.all('SELECT text FROM entry_glosses WHERE entry_id = ? ORDER BY ord', [row.id]),
      driver.all(
        'SELECT tl.json AS pos FROM entry_senses s JOIN tag_lists tl ON tl.id = s.pos_id WHERE s.entry_id = ? ORDER BY s.ord',
        [row.id],
      ),
    ]);
    row.kanji = kanji.map((r) => r.text);
    row.readings = readings.map((r) => r.text);
    row.glosses = glosses.map((r) => r.text);
    // Raw JMdict pos tags (v5k, adj-i, n, ...), deduped in first-seen order
    // across senses - no display bucketing/relabeling.
    row.pos = [...new Set(senses.flatMap((s) => JSON.parse(s.pos)))];
    row.archaic = row.is_archaic === 1;
    row.labels = row.labels ? row.labels.split(',') : [];
    row.dialect = row.dialect ? row.dialect.split(',').map(dialectLabel) : [];
    // Raw tags (news1, ichi1, nf12, ...); see frequency-labels.js for the
    // decoded meaning behind each one.
    row.priority = row.priority ? row.priority.split(',') : [];
    delete row.is_archaic;
  }));
  return rows;
}
