/*
 * SQLite connection singleton.
 *
 * The handle is opened lazily on first call to `getDb()` and reused after.
 * Callers pass the database file path via `init()` before any service call;
 * `main/index.js` does this once at boot. Tests can call `init(':memory:')`.
 *
 * When porting to a server, this module is replaced by a Postgres pool
 * wrapper that exposes the same `getDb()` / `transaction()` shape. The
 * repositories are written to that minimal surface — no SQLite-specifics
 * leak past this file.
 */

const Database = require('better-sqlite3');

let dbInstance = null;
let dbPath = null;

function init(filePath) {
  if (dbInstance) return dbInstance;
  dbPath = filePath;
  dbInstance = new Database(filePath);
  // PRAGMAs we want set for the life of the connection.
  // WAL: durable + reader-writer concurrency; the default for production-ish
  // SQLite usage. foreign_keys: ON is OFF by default in SQLite — required
  // for our ON DELETE rules to take effect.
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');
  return dbInstance;
}

function getDb() {
  if (!dbInstance) {
    throw new Error('Database not initialized — call init(path) first.');
  }
  return dbInstance;
}

function getPath() {
  return dbPath;
}

function close() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    dbPath = null;
  }
}

/*
 * Wraps a function in a transaction. better-sqlite3's `transaction()` returns
 * a function that runs synchronously and rolls back on throw — exactly what
 * the service layer wants for multi-statement operations.
 */
function transaction(fn) {
  return getDb().transaction(fn);
}

module.exports = { init, getDb, getPath, close, transaction };
