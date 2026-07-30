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
import { decompress } from 'fzstd';
import localforage from 'localforage';

let webStoreReady = null;

/** Idempotent: safe to call from multiple driver instances. */
function ensureWebStore(sqlite) {
  webStoreReady ??= sqlite.initWebStore();
  return webStoreReady;
}

// jeep-sqlite's own IndexedDB store, replicated here (not imported - it's an
// internal of the jeep-sqlite package, not part of its public API) so a
// `.zst` URL can land its bytes in exactly the spot getFromHTTPRequest's
// DEFLATE-only `.zip`/`.db` path would have put them: same localforage
// database/store name jeep-sqlite's own `openStore('jeepSqliteStore',
// 'databases')` creates, and the same `<database>SQLite.db` key its
// `Database` class reads from on open() (see node_modules/jeep-sqlite's
// components/jeep-sqlite.js and utils/database.js). This is a real coupling
// to jeep-sqlite's internals rather than its documented API - if a
// jeep-sqlite upgrade ever makes a zstd-imported database fail to open,
// check this against that version's openStore()/Database constructor first.
const JEEP_SQLITE_STORE_CONFIG = { name: 'jeepSqliteStore', storeName: 'databases', driver: [localforage.INDEXEDDB], version: 1 };

// Where the fingerprint of the currently-imported database is recorded (keyed
// by logical database name), so a deploy that ships new bytes can be detected
// instead of ignored - see ensureDatabaseFromUrl.
//
// Its own IndexedDB database rather than another store inside
// jeepSqliteStore: adding an object store to an existing IndexedDB database
// means bumping its version, and that database's version is jeep-sqlite's to
// own, not ours. Not localStorage either - not for the quota (a hash is 64
// bytes) but because a fingerprint that outlives the database it describes is
// worse than no fingerprint, and localStorage and IndexedDB are cleared
// independently by browsers under storage pressure and by "clear site data"
// UI. Same-store-as-the-data keeps "cached copy" and "what the cached copy
// is" evictable as one unit.
const FINGERPRINT_STORE_CONFIG = { name: 'kiwamiDictionaryMeta', storeName: 'fingerprints', driver: [localforage.INDEXEDDB], version: 1 };

/**
 * Reads the build's `dictionary.manifest.json` (scripts/manifest-db.mjs).
 * `no-store` because an HTTP-cached manifest would report the old build's
 * hash and defeat the entire check. Returns null on any failure - a missing
 * or unparseable manifest means "can't tell", which must leave a working
 * cached database alone rather than trigger a 40MB re-download (this is the
 * offline case, among others).
 */
async function fetchManifest(manifestUrl) {
  try {
    const response = await fetch(manifestUrl, { cache: 'no-store' });
    if (!response.ok) return null;
    const manifest = await response.json();
    return typeof manifest?.sha256 === 'string' ? manifest : null;
  } catch {
    return null;
  }
}

// Fetches and decompresses a zstd-compressed database ourselves, since
// jeep-sqlite's built-in HTTP-import path only understands raw `.db` or
// DEFLATE-zipped `.zip` (see ensureDatabaseFromUrl's jsdoc for the size win
// this buys over that format). fzstd is a pure-JS decoder - see
// scripts/zstd-db.sh for why the build side is pinned to zstd level 19 to
// stay inside the backreference-distance limit fzstd documents for
// non-"ultra" archives.
async function importZstdDatabase(database, url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetching ${url} failed: ${response.status} ${response.statusText}`);
  const compressed = new Uint8Array(await response.arrayBuffer());
  const bytes = decompress(compressed);
  const store = localforage.createInstance(JEEP_SQLITE_STORE_CONFIG);
  const key = `${database}SQLite.db`;
  await store.removeItem(key);
  await store.setItem(key, bytes);
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
 * `url` must end in `.db`, `.zip`, or `.zst`. `.zst` — what the app actually
 * ships, `public/dictionary.db.zst` (scripts/zstd-db.sh) — goes through
 * `importZstdDatabase` above, since jeep-sqlite's bundled unzip only
 * understands DEFLATE. `.db`/`.zip` instead go through jeep-sqlite's own
 * HTTP-import path, which switches on the URL's file extension (see its
 * `getFileExtensionInUrl`) and silently no-ops on anything else; nothing in
 * this project builds either of those anymore, but the branch costs nothing
 * to keep and jeep-sqlite still understands both natively if one's ever
 * produced again. Existence is checked with `isDatabase()`, which — unlike
 * `isDBExists()` — looks at the store directly instead of requiring a
 * connection to already be open.
 *
 * `force` deletes any existing IndexedDB copy first, for the reload button's
 * "give me the shipped database no matter what" case.
 *
 * A drifted cache is detected without it, though, and re-imported the same
 * way: `exists` alone can't tell a current copy from the one a browser
 * imported two deploys ago, so when `manifestUrl` is given, the sha256 in
 * that manifest (scripts/manifest-db.mjs) is compared against the fingerprint
 * recorded at import time and a mismatch forces the re-import. Without this,
 * a schema change (e.g. a new table) ships a fresh `dictionary.db.zst` that
 * every already-populated browser silently never re-fetches, and keeps
 * querying the old schema until someone hits reload by hand.
 *
 * An existing database with *no* recorded fingerprint counts as drifted: it
 * was imported by a build from before this check existed, and "probably fine"
 * isn't distinguishable from "two schemas stale" without re-importing once.
 * That costs those browsers a single extra download, after which the
 * fingerprint is known.
 *
 * Returns why it imported (or `null` if it didn't), which the caller uses to
 * tell "Downloading" from "Updating" in the status line - a returning user who
 * suddenly waits for a download deserves to know it's an update.
 *
 * jeep-sqlite's `deleteDatabase` looks up its internal `RW_<database>`
 * connection record to find the file handle to delete, rather than opening
 * one itself — calling it without a non-readonly connection registered
 * fails with "DeleteDatabase: No available connection for <database>"
 * (this app only ever opens the dictionary readonly, so that record never
 * exists otherwise). Create one just for the delete, then release it.
 * @param {string} database
 * @param {string} url
 * @param {{ force?: boolean, manifestUrl?: string, onImportStart?: (reason: 'missing' | 'drifted' | 'forced') => void }} [options]
 * @returns {Promise<'missing' | 'drifted' | 'forced' | null>}
 */
export async function ensureDatabaseFromUrl(database, url, options = {}) {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  await ensureWebStore(sqlite);
  const { result: exists } = await sqlite.isDatabase(database);
  const fingerprints = localforage.createInstance(FINGERPRINT_STORE_CONFIG);

  // Only worth a network round-trip when there's a cached copy whose currency
  // is in question: with nothing cached the database is about to be fetched
  // regardless, and `force` has already decided to refetch.
  const manifest = exists && !options.force && options.manifestUrl
    ? await fetchManifest(options.manifestUrl)
    : null;
  const cachedFingerprint = exists ? await fingerprints.getItem(database) : null;
  const drifted = manifest !== null && cachedFingerprint !== manifest.sha256;
  if (drifted) {
    console.info(`[dictionary] cached copy is stale (had ${cachedFingerprint ?? 'no fingerprint'}, build ships ${manifest.sha256.slice(0, 12)}…) — re-importing`);
  }

  const reason = !exists ? 'missing' : options.force ? 'forced' : drifted ? 'drifted' : null;
  if (reason === null) return null;
  options.onImportStart?.(reason);

  if (exists) {
    const { result: hasRwConnection } = await sqlite.isConnection(database, false);
    const conn = hasRwConnection
      ? await sqlite.retrieveConnection(database, false)
      : await sqlite.createConnection(database, false, 'no-encryption', 1, false);
    await conn.delete();
    if (!hasRwConnection) await sqlite.closeConnection(database, false);
  }

  // Cleared before the import, not just written after: a re-import that fails
  // halfway (a dropped connection mid-download) must not leave the previous
  // build's fingerprint sitting over whatever bytes survived, or the next load
  // reads that as "current" and the stale-cache bug comes back permanently.
  await fingerprints.removeItem(database);

  // Read before the download, not after. Either order can straddle a deploy
  // that lands mid-import, but only this one fails safe: reading first can
  // record the older hash against newer bytes, which the next load sees as
  // drift and corrects with one redundant re-import. Reading afterward records
  // the newer hash against older bytes - indistinguishable from current, so
  // that browser is stuck on a stale database until the deploy after next.
  // (`manifest` above is null on the missing/forced paths, so it can't just be
  // reused.)
  const expected = manifest ?? (options.manifestUrl ? await fetchManifest(options.manifestUrl) : null);
  if (url.endsWith('.zst')) {
    await importZstdDatabase(database, url);
  } else {
    await sqlite.getFromHTTPRequest(url, false);
  }
  if (expected) await fingerprints.setItem(database, expected.sha256);
  return reason;
}
