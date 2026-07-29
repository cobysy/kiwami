// Node/Electron driver: node:sqlite (Node's built-in DatabaseSync) opening
// the SQLite file directly by path. Used as-is for the Node dev/test
// harness; the real Electron shell (Phase 3) forwards these same calls over
// IPC from the renderer instead of calling node:sqlite in-process, but the
// main-process side is this file.
import { DatabaseSync } from 'node:sqlite';

/**
 * @param {string} filePath - path to the SQLite file, or ':memory:'
 * @param {{ readonly?: boolean }} [options]
 * @returns {import('../sqlite-driver.js').DBDriver}
 */
export function createNodeDriver(filePath, options = {}) {
  const readonly = options.readonly ?? false;
  let db = null;

  return {
    async open() {
      // node:sqlite enables foreign key enforcement by default (unlike
      // better-sqlite3, which needs `PRAGMA foreign_keys = ON` explicitly).
      db = new DatabaseSync(filePath, { readOnly: readonly });
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
