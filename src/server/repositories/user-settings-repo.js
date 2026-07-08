/*
 * Durable per-user settings (011_user_settings.sql). Replaces the in-memory
 * Map that settings.ipc.js used to hold. Values are opaque strings; the
 * renderer decides the encoding (usually JSON).
 */

const { getDb } = require('../db/connection');

function getAll(userId) {
  const rows = getDb().prepare(
    'SELECT key, value FROM user_settings WHERE user_id = ?'
  ).all(userId);
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

// Upsert one or many key/value pairs for a user.
function setMany(userId, entries) {
  const stmt = getDb().prepare(`
    INSERT INTO user_settings (user_id, key, value, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, key) DO UPDATE SET
      value = excluded.value,
      updated_at = datetime('now')
  `);
  const tx = getDb().transaction((pairs) => {
    for (const [k, v] of pairs) stmt.run(userId, String(k), v == null ? null : String(v));
  });
  tx(Object.entries(entries || {}));
  return getAll(userId);
}

module.exports = { getAll, setMany };
