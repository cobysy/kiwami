// Node/Electron driver: better-sqlite3 opening the SQLite file directly by
// path. Used as-is for the Node dev/test harness; the real Electron shell
// (Phase 3) forwards these same calls over IPC from the renderer instead of
// calling better-sqlite3 in-process, but the main-process side is this file.
import Database from 'better-sqlite3';

/**
 * @param {string} filePath - path to the SQLite file, or ':memory:'
 * @param {{ readonly?: boolean }} [options]
 * @returns {import('../driver.js').DBDriver}
 */
export function createNodeDriver(filePath, options = {}) {
  const readonly = options.readonly ?? false;
  let db = null;

  return {
    async open() {
      db = new Database(filePath, { readonly });
      db.pragma('foreign_keys = ON');
    },
    async exec(sql) {
      db.exec(sql);
    },
    async all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async run(sql, params = []) {
      const info = db.prepare(sql).run(...params);
      return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
    },
    async close() {
      db?.close();
      db = null;
    },
  };
}
