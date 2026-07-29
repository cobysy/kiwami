// Tiered plain-text match + wildcard search, per PLAN.md Phase 1:
//   "Tiered plain-text match: exact match on reading/kanji/gloss, then
//   prefix, then substring, stopping as soon as a tier returns good hits."
//   "Wildcards: if the query contains `?` or `*`, parse as an explicit
//   pattern ... and skip fuzzy correction."
//   "Kanji-count filter: expose headword length filtering ... as a query
//   parameter, a facet on top of the base query."
//
// Deliberately doesn't use the `search_fts` FTS5 table the build pipeline
// creates (see scripts/assemble-sqlite.mjs) even though it would make
// reading/gloss prefix and substring matching faster on the real dictionary.
// Found while getting Phase 1's browser driver working: jeep-sqlite's web
// fallback runs on sql.js, whose standard published WASM build has no FTS5
// module compiled in ("no such module: fts5"), and its bundled JS glue is
// frozen against a specific sql.js WASM ABI — swapping in a different
// FTS5-enabled sql.js build breaks that ABI instead of fixing it (tried;
// got a LinkError, then a "null function" runtime abort). better-sqlite3
// (Node/Electron) and iOS's native SQLite both support FTS5 fine, so this
// is a browser-dev-driver-only gap, not a schema problem — but Phase 1's
// explicit goal is one query layer that behaves identically on every
// driver, so every tier here uses the same LIKE-scan approach on
// entry_kanji/entry_readings/entry_glosses.text uniformly, same as kanji
// substring search already had to (see PLAN.md open decision 5). Revisit
// FTS5 later as a native-only optimization behind a driver capability flag
// if reading/gloss scan performance turns out to matter on-device.
import { fetchEntriesByIds } from './entries.js';

const TIERS = ['exact', 'prefix', 'substring'];

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

async function collectIds(driver, queries) {
  const ids = new Set();
  for (const { sql, params } of queries) {
    for (const row of await driver.all(sql, params)) ids.add(row.id);
  }
  return ids;
}

function fieldQuery({ table, alias, column }, whereExpr, value, kc, kcParams) {
  return {
    sql: `SELECT DISTINCT ${alias}.entry_id AS id FROM ${table} ${alias} JOIN entries e ON e.id = ${alias}.entry_id WHERE ${whereExpr} ${kc}`,
    params: [value, ...kcParams],
  };
}

async function tierEntryIds(driver, tier, query, kanjiCount) {
  const { clause: kc, params: kcParams } = kanjiCountClause(kanjiCount);

  if (tier === 'exact') {
    return collectIds(driver, [
      fieldQuery(FIELDS[0], `${FIELDS[0].alias}.${FIELDS[0].column} = ?`, query, kc, kcParams),
      fieldQuery(FIELDS[1], `${FIELDS[1].alias}.${FIELDS[1].column} = ?`, query, kc, kcParams),
      fieldQuery(FIELDS[2], `LOWER(${FIELDS[2].alias}.${FIELDS[2].column}) = LOWER(?)`, query, kc, kcParams),
    ]);
  }

  const pattern = tier === 'prefix' ? `${query}%` : `%${query}%`;
  return collectIds(driver, FIELDS.map((field) =>
    fieldQuery(field, `${field.alias}.${field.column} LIKE ? ESCAPE '\\'`, pattern, kc, kcParams)));
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

async function wildcardEntryIds(driver, query, kanjiCount) {
  const pattern = wildcardToLikePattern(query);
  const { clause: kc, params: kcParams } = kanjiCountClause(kanjiCount);
  // Wildcards target headword shape (kanji/reading), not glosses.
  return collectIds(driver, [FIELDS[0], FIELDS[1]].map((field) =>
    fieldQuery(field, `${field.alias}.${field.column} LIKE ? ESCAPE '\\'`, pattern, kc, kcParams)));
}

/**
 * @param {import('../driver.js').DBDriver} driver
 * @param {string} queryText
 * @param {{ kanjiCount?: 1|2|3|4, limit?: number }} [options] - kanjiCount 4
 *   means "4 or more", matching PLAN.md's "1 / 2 / 3 / 4+" chip spec.
 * @returns {Promise<{ tier: 'exact'|'prefix'|'substring'|'wildcard', results: Array<object> }>}
 */
export async function search(driver, queryText, options = {}) {
  const query = (queryText ?? '').trim();
  if (!query) return { tier: null, results: [] };

  if (/[?*]/.test(query)) {
    const ids = await wildcardEntryIds(driver, query, options.kanjiCount);
    return { tier: 'wildcard', results: await fetchEntriesByIds(driver, ids, options) };
  }

  for (const tier of TIERS) {
    const ids = await tierEntryIds(driver, tier, query, options.kanjiCount);
    if (ids.size > 0) {
      return { tier, results: await fetchEntriesByIds(driver, ids, options) };
    }
  }
  return { tier: 'substring', results: [] };
}
