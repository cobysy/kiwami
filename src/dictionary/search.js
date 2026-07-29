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
import { fetchEntriesByIds } from './dictionary-entries.js';
import { romajiToHiragana } from './romaji.js';

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
// in dictionary-entries.js, but dialect tags are rare enough (~600 of
// 250k+ senses) that a full scan is cheap regardless.
function dialectClause(dialect) {
  if (!dialect) return { clause: '', params: [] };
  return {
    clause: `AND EXISTS (
      SELECT 1 FROM entry_senses dialect_senses
      JOIN tag_lists tl ON tl.id = dialect_senses.dial_id, json_each(tl.json) dialect_tag
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
  const results = await Promise.all(queries.map(({ sql, params }) => driver.all(sql, params)));
  for (const rows of results) {
    for (const row of rows) ids.add(row.id);
  }
  return ids;
}

function fieldQuery({ table, alias, column }, whereExpr, value, facet) {
  return {
    sql: `SELECT DISTINCT ${alias}.entry_id AS id FROM ${table} ${alias} JOIN entries e ON e.id = ${alias}.entry_id WHERE ${whereExpr} ${facet.clause}`,
    params: [value, ...facet.params],
  };
}

// `texts.kanjiReading` and `texts.gloss` are usually the same string - they
// only diverge when the query was typed in romaji (see search()), since a
// romaji-converted kana query makes sense against kanji/reading text but
// would corrupt a search over English glosses.
async function tierEntryIds(driver, tier, texts, options) {
  const facet = facetClauses(options);
  const { kanjiReading, gloss } = texts;

  if (tier === 'exact') {
    return collectIds(driver, [
      fieldQuery(FIELDS[0], `${FIELDS[0].alias}.${FIELDS[0].column} = ?`, kanjiReading, facet),
      fieldQuery(FIELDS[1], `${FIELDS[1].alias}.${FIELDS[1].column} = ?`, kanjiReading, facet),
      fieldQuery(FIELDS[2], `${FIELDS[2].alias}.${FIELDS[2].column} = ?`, gloss, facet),
    ]);
  }

  const kanjiReadingPattern = tier === 'prefix' ? `${kanjiReading}%` : `%${kanjiReading}%`;
  const glossPattern = tier === 'prefix' ? `${gloss}%` : `%${gloss}%`;
  return collectIds(driver, [
    fieldQuery(FIELDS[0], `${FIELDS[0].alias}.${FIELDS[0].column} LIKE ? ESCAPE '\\'`, kanjiReadingPattern, facet),
    fieldQuery(FIELDS[1], `${FIELDS[1].alias}.${FIELDS[1].column} LIKE ? ESCAPE '\\'`, kanjiReadingPattern, facet),
    fieldQuery(FIELDS[2], `${FIELDS[2].alias}.${FIELDS[2].column} LIKE ? ESCAPE '\\'`, glossPattern, facet),
  ]);
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
 * @param {import('./sqlite-driver.js').DBDriver} driver
 * @param {string} queryText
 * @param {{ kanjiCount?: 1|2|3|4, dialect?: string, limit?: number }} [options] -
 *   kanjiCount 4 means "4 or more", matching PLAN.md's "1 / 2 / 3 / 4+" chip
 *   spec. dialect is a JMdict dial tag (e.g. 'ksb') - see dialect-labels.js.
 * @returns {Promise<{ tier: 'exact'|'prefix'|'substring'|'wildcard'|'dialect'|null, results: Array<object>, interpretedQuery?: string }>} -
 *   interpretedQuery is the romaji-to-kana conversion actually searched
 *   with (e.g. "jibun" -> "じぶん"), present only when that happened.
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

  // A romaji query (e.g. "jibun") can't literally match kanji/reading text,
  // only its kana conversion (じぶん) can - so kanji/reading tiers search
  // that conversion when one exists, while glosses always keep searching
  // the raw text (an English gloss query must never be run through a
  // romaji->kana conversion). romajiToHiragana returns null for anything
  // that isn't fully romaji (English words/phrases, wildcards), so this is
  // a no-op - texts.kanjiReading just falls back to the raw query - for
  // every query that isn't actually romaji.
  const kanaQuery = romajiToHiragana(query);
  const texts = { kanjiReading: kanaQuery ?? query, gloss: query };
  const interpretedQuery = kanaQuery && kanaQuery !== query ? kanaQuery : undefined;

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
  const [exactIds, prefixIds] = await Promise.all([
    tierEntryIds(driver, 'exact', texts, options),
    tierEntryIds(driver, 'prefix', texts, options),
  ]);
  if (exactIds.size > 0 || prefixIds.size > 0) {
    const limit = options.limit ?? 100;
    const exactResults = await fetchEntriesByIds(driver, exactIds, { ...options, limit });
    const onlyPrefixIds = new Set([...prefixIds].filter((id) => !exactIds.has(id)));
    const remaining = limit - exactResults.length;
    const prefixResults = remaining > 0
      ? await fetchEntriesByIds(driver, onlyPrefixIds, { ...options, limit: remaining })
      : [];
    return {
      tier: exactIds.size > 0 ? 'exact' : 'prefix',
      results: [...exactResults, ...prefixResults],
      interpretedQuery,
    };
  }

  const substringIds = await tierEntryIds(driver, 'substring', texts, options);
  return { tier: 'substring', results: await fetchEntriesByIds(driver, substringIds, options), interpretedQuery };
}
