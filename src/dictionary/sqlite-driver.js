// Shared SQLite driver interface. Every platform backend (Node/Electron via
// node:sqlite, iOS/browser-dev via the Capacitor SQLite plugin) implements
// this exact shape; the query layer alongside it in this folder (search.js,
// fuzzy.js, deconjugate.js, ...) is written only against it and must not
// know which backend is active underneath.
//
// Three methods instead of PLAN.md's single `run(sql, params) -> rows`
// example: both real backends already draw this same line internally
// (node:sqlite's `exec` vs `prepare().all()`/`prepare().run()`; the
// Capacitor SQLite plugin's `execute` vs `query`/`run`), so mirroring it here
// avoids a driver-side heuristic guessing "is this DDL or a parameterized
// statement" from a SQL string.
//
// @typedef {Object} DBDriver
// @property {() => Promise<void>} open
// @property {(sql: string) => Promise<void>} exec
//   Run one or more `;`-separated statements (schema/DDL/seed data). No
//   params, no return value.
// @property {(sql: string, params?: Array<*>) => Promise<Array<Record<string, *>>>} all
//   Run a single SELECT, return every row as a plain object.
// @property {(sql: string, params?: Array<*>) => Promise<{changes: number, lastInsertRowid: number|undefined}>} run
//   Run a single INSERT/UPDATE/DELETE.
// @property {() => Promise<void>} close

export const DRIVER_METHODS = ['open', 'exec', 'all', 'run', 'close'];

/** Throws if `driver` doesn't implement the full DBDriver shape. */
export function assertDriver(driver) {
  for (const method of DRIVER_METHODS) {
    if (typeof driver?.[method] !== 'function') {
      throw new TypeError(`driver is missing required method "${method}"`);
    }
  }
}
