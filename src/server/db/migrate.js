/*
 * Migration runner.
 *
 * Reads every *.sql file in ./migrations in lexical order, applies the ones
 * that haven't been recorded in the `_migrations` table yet, and records
 * them on success. Each migration runs inside a transaction.
 *
 * To add a new migration: create `NNN_description.sql` with a higher number
 * than the last applied file. Never edit an applied migration — write a new
 * one that ALTERs the prior state.
 */

const fs = require('fs');
const path = require('path');
const { getDb } = require('./connection');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function ensureBookkeeping(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function applied(db) {
  const rows = db.prepare('SELECT filename FROM _migrations').all();
  return new Set(rows.map(r => r.filename));
}

function listFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
}

function runMigrations() {
  const db = getDb();
  ensureBookkeeping(db);
  const done = applied(db);
  const files = listFiles();
  const ran = [];

  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(file);
    });
    tx();
    ran.push(file);
  }

  return { applied: ran, total: files.length };
}

module.exports = { runMigrations };
