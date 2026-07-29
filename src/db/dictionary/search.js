// Tiered plain-text match + wildcard search, per PLAN.md Phase 1:
//   "Tiered plain-text match: exact match on reading/kanji/gloss, then
//   prefix, then substring, stopping as soon as a tier returns good hits."
//   "Wildcards: if the query contains `?` or `*`, parse as an explicit
//   pattern ... and skip fuzzy correction."
//   "Kanji-count filter: expose headword length filtering ... as a query
//   parameter, a facet on top of the base query."
//
// Revised from that original "stop at the first non-empty tier" design:
// exact and prefix are now always merged (see search() below) so an exact
// hit like 白い doesn't hide a compound like 白いんげん豆 — real usage
// showed that was surprising, not desirable. Substring still only runs
// when exact+prefix are empty, since it's the expensive unindexed scan.
//
// Every tier uses the same LIKE-scan approach on
// entry_kanji/entry_readings/entry_glosses.text uniformly, so behavior is
// identical across every driver (Phase 1's explicit goal — see PLAN.md open
// decision 5).
import { fetchEntriesByIds } from './entries.js';

// entry_glosses has no dedicated equality/prefix index (see schema), so its
// exact-tier lookup is done case-insensitively via LOWER() rather than the
// literal `=` the kanji/reading tables can use directly.
const FIELDS = [
  { table: 'entry_kanji', alias: 'ek', column: 'text' },
  { table: 'entry_readings', alias: 'er', column: 'text' },
  { table: 'entry_glosses', alias: 'eg', column: 'text' },
];

// PLAN.md's chip row is "1 / 2 / 3 / 4+"; kanjiCount 4 means "4 or more".
function kanjiCountClause(kanjiCount) {
  if (!kanjiCount) return { clause: '', params: [] };
  const op = kanjiCount >= 4 ? '>=' : '=';
  return { clause: `AND e.kanji_count ${op} ?`, params: [kanjiCount] };
}

// Regional-dialect facet (entry_senses.dial, e.g. 'ksb' for Kansai-ben —
// see dialect-labels.js). Unindexed json_each scan, same as LABELS_SUBQUERY
// in entries.js, but dialect tags are rare enough (~600 of 250k+ senses)
// that a full scan is cheap regardless.
function dialectClause(dialect) {
  if (!dialect) return { clause: '', params: [] };
  return {
    clause: `AND EXISTS (
      SELECT 1 FROM entry_senses dialect_senses, json_each(dialect_senses.dial) dialect_tag
      WHERE dialect_senses.entry_id = e.id AND dialect_tag.value = ?
    )`,
    params: [dialect],
  };
}

// Combines every facet (kanji-count, dialect, ...) into one clause+params
// pair so tier/wildcard/browse queries all apply them the same way.
function facetClauses({ kanjiCount, dialect } = {}) {
  const kanjiCountFacet = kanjiCountClause(kanjiCount);
  const dialectFacet = dialectClause(dialect);
  return {
    clause: `${kanjiCountFacet.clause} ${dialectFacet.clause}`,
    params: [...kanjiCountFacet.params, ...dialectFacet.params],
  };
}

async function collectIds(driver, queries) {
  const ids = new Set();
  for (const { sql, params } of queries) {
    for (const row of await driver.all(sql, params)) ids.add(row.id);
  }
  return ids;
}

function fieldQuery({ table, alias, column }, whereExpr, value, facet) {
  return {
    sql: `SELECT DISTINCT ${alias}.entry_id AS id FROM ${table} ${alias} JOIN entries e ON e.id = ${alias}.entry_id WHERE ${whereExpr} ${facet.clause}`,
    params: [value, ...facet.params],
  };
}

async function tierEntryIds(driver, tier, query, options) {
  const facet = facetClauses(options);

  if (tier === 'exact') {
    return collectIds(driver, [
      fieldQuery(FIELDS[0], `${FIELDS[0].alias}.${FIELDS[0].column} = ?`, query, facet),
      fieldQuery(FIELDS[1], `${FIELDS[1].alias}.${FIELDS[1].column} = ?`, query, facet),
      fieldQuery(FIELDS[2], `LOWER(${FIELDS[2].alias}.${FIELDS[2].column}) = LOWER(?)`, query, facet),
    ]);
  }

  const pattern = tier === 'prefix' ? `${query}%` : `%${query}%`;
  return collectIds(driver, FIELDS.map((field) =>
    fieldQuery(field, `${field.alias}.${field.column} LIKE ? ESCAPE '\\'`, pattern, facet)));
}

/** Translates a `?`/`*` wildcard query into a SQL LIKE pattern, escaping any literal `%`/`_`/`\`. */
export function wildcardToLikePattern(query) {
  let pattern = '';
  for (const ch of query) {
    if (ch === '?') pattern += '_';
    else if (ch === '*') pattern += '%';
    else if (ch === '%' || ch === '_' || ch === '\\') pattern += `\\${ch}`;
    else pattern += ch;
  }
  return pattern;
}

async function wildcardEntryIds(driver, query, options) {
  const pattern = wildcardToLikePattern(query);
  const facet = facetClauses(options);
  // Wildcards target headword shape (kanji/reading), not glosses.
  return collectIds(driver, [FIELDS[0], FIELDS[1]].map((field) =>
    fieldQuery(field, `${field.alias}.${field.column} LIKE ? ESCAPE '\\'`, pattern, facet)));
}

// Browse mode: list every entry tagged with a given dialect, with no text
// query at all (the "show me all Kansai-ben" case) - kanji-count still
// applies as a facet, same as it does alongside a text search.
async function dialectEntryIds(driver, options) {
  const facet = facetClauses(options);
  const rows = await driver.all(
    `SELECT DISTINCT e.id AS id FROM entries e WHERE 1=1 ${facet.clause}`,
    facet.params,
  );
  return new Set(rows.map((r) => r.id));
}

/**
 * @param {import('../driver.js').DBDriver} driver
 * @param {string} queryText
 * @param {{ kanjiCount?: 1|2|3|4, dialect?: string, limit?: number }} [options] -
 *   kanjiCount 4 means "4 or more", matching PLAN.md's "1 / 2 / 3 / 4+" chip
 *   spec. dialect is a JMdict dial tag (e.g. 'ksb') - see dialect-labels.js.
 * @returns {Promise<{ tier: 'exact'|'prefix'|'substring'|'wildcard'|'dialect'|null, results: Array<object> }>}
 */
export async function search(driver, queryText, options = {}) {
  const query = (queryText ?? '').trim();

  if (!query) {
    // No text typed: if a dialect facet is set, browse every entry tagged
    // with it (the "show me all Kansai-ben" case) instead of coming back
    // empty - otherwise there's genuinely nothing to search for.
    if (!options.dialect) return { tier: null, results: [] };
    const ids = await dialectEntryIds(driver, options);
    return { tier: 'dialect', results: await fetchEntriesByIds(driver, ids, options) };
  }

  if (/[?*]/.test(query)) {
    const ids = await wildcardEntryIds(driver, query, options);
    return { tier: 'wildcard', results: await fetchEntriesByIds(driver, ids, options) };
  }

  // Exact and prefix are always merged (an exact hit like 白い shouldn't
  // hide a compound like 白いんげん豆) rather than stopping at the first
  // non-empty tier: prefix's `LIKE 'foo%'` still benefits from
  // entry_kanji/entry_readings' plain b-tree indexes, so it's cheap enough
  // to run on every query. Substring stays gated behind "nothing found
  // yet" since it's the unindexed full-table `LIKE '%foo%'` scan.
  //
  // Exact hits get the full result-limit budget to themselves first, and
  // prefix hits only fill whatever's left over — a short common word (e.g.
  // 水) can have dozens of common compounds as prefix matches, which would
  // otherwise crowd every exact hit but that one word out of the results
  // entirely once both compete for the same capped list.
  const exactIds = await tierEntryIds(driver, 'exact', query, options);
  const prefixIds = await tierEntryIds(driver, 'prefix', query, options);
  if (exactIds.size > 0 || prefixIds.size > 0) {
    const limit = options.limit ?? 50;
    const exactResults = await fetchEntriesByIds(driver, exactIds, { ...options, limit });
    const onlyPrefixIds = new Set([...prefixIds].filter((id) => !exactIds.has(id)));
    const remaining = limit - exactResults.length;
    const prefixResults = remaining > 0
      ? await fetchEntriesByIds(driver, onlyPrefixIds, { ...options, limit: remaining })
      : [];
    return {
      tier: exactIds.size > 0 ? 'exact' : 'prefix',
      results: [...exactResults, ...prefixResults],
    };
  }

  const substringIds = await tierEntryIds(driver, 'substring', query, options);
  return { tier: 'substring', results: await fetchEntriesByIds(driver, substringIds, options) };
}
