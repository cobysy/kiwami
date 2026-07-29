// Browser dev-test driver, and the web fallback the Capacitor SQLite plugin
// ships for exactly this purpose: exercising the driver interface and the
// query layer in a plain `vite dev` tab, no iPhone install needed until
// Phase 3/7's real on-device validation (see PLAN.md Phase 1). Backed by
// `jeep-sqlite`, a Stencil web component that runs sql.js (SQLite compiled
// to WASM) and persists to IndexedDB.
//
// Two setup steps this relies on that live outside this file:
//   - a single `<jeep-sqlite>` element mounted in the page (see src/main.js)
//   - `node_modules/sql.js/dist/sql-wasm.wasm` copied to `public/assets/sql-wasm.wasm`
//     (documented in package.json's `postinstall` script)
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';

let webStoreReady = null;

/** Idempotent: safe to call from multiple driver instances. */
function ensureWebStore(sqlite) {
  webStoreReady ??= sqlite.initWebStore();
  return webStoreReady;
}

/**
 * @param {string} database - logical database name (no extension, no path)
 * @param {{ readonly?: boolean }} [options]
 * @returns {import('../sqlite-driver.js').DBDriver}
 */
export function createBrowserDriver(database, options = {}) {
  const readonly = options.readonly ?? false;
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  let conn = null;

  return {
    async open() {
      await ensureWebStore(sqlite);
      const { result: alreadyOpen } = await sqlite.isConnection(database, readonly);
      conn = alreadyOpen
        ? await sqlite.retrieveConnection(database, readonly)
        : await sqlite.createConnection(database, false, 'no-encryption', 1, readonly);
      await conn.open();
    },
    async exec(sql) {
      await conn.execute(sql, false);
    },
    async all(sql, params = []) {
      const { values } = await conn.query(sql, params);
      return values ?? [];
    },
    async run(sql, params = []) {
      const { changes } = await conn.run(sql, params, false);
      return { changes: changes?.changes ?? 0, lastInsertRowid: changes?.lastId };
    },
    async close() {
      await sqlite.closeConnection(database, readonly);
      conn = null;
    },
  };
}

/**
 * Loads a prepopulated database into the web store from a URL, skipping the
 * fetch if it's already present — mirrors the "missing/empty -> re-fetch,
 * otherwise open local copy" behaviour PLAN.md's Phase 1 describes for the
 * native drivers. Must run before `createBrowserDriver(name).open()` for
 * that same `name`.
 *
 * `url` must end in `.db` (or `.zip`) — jeep-sqlite's HTTP-import path
 * switches on the URL's file extension (see its `getFileExtensionInUrl`)
 * and silently no-ops on anything else, which is why the assembled
 * dictionary ships as `public/dictionary.db` rather than `.sqlite`
 * (see scripts/assemble-sqlite.mjs). Checked with `isDatabase()`, which —
 * unlike `isDBExists()` — looks at the store directly instead of requiring
 * a connection to already be open.
 *
 * `force` deletes any existing IndexedDB copy first: without it, a schema
 * change (e.g. a new table) ships a fresh `dictionary.db.zip` that browsers
 * with an already-populated store silently never re-fetch, since `exists`
 * is already true.
 *
 * jeep-sqlite's `deleteDatabase` looks up its internal `RW_<database>`
 * connection record to find the file handle to delete, rather than opening
 * one itself — calling it without a non-readonly connection registered
 * fails with "DeleteDatabase: No available connection for <database>"
 * (this app only ever opens the dictionary readonly, so that record never
 * exists otherwise). Create one just for the delete, then release it.
 * @param {string} database
 * @param {string} url
 * @param {{ force?: boolean }} [options]
 */
export async function ensureDatabaseFromUrl(database, url, options = {}) {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  await ensureWebStore(sqlite);
  const { result: exists } = await sqlite.isDatabase(database);
  if (exists && options.force) {
    const { result: hasRwConnection } = await sqlite.isConnection(database, false);
    const conn = hasRwConnection
      ? await sqlite.retrieveConnection(database, false)
      : await sqlite.createConnection(database, false, 'no-encryption', 1, false);
    await conn.delete();
    if (!hasRwConnection) await sqlite.closeConnection(database, false);
  }
  if (!exists || options.force) {
    await sqlite.getFromHTTPRequest(url, false);
  }
}
