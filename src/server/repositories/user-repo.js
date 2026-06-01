/*
 * Data access for users. Repositories are the ONLY place SQL is written
 * outside of migrations — services call repository methods, never raw SQL.
 * When porting to Postgres, change the placeholder style here ($1, $2) and
 * the rest of the codebase keeps working.
 */

const { getDb } = require('../db/connection');

function findById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

function findByEmail(email) {
  return getDb()
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(String(email).toLowerCase()) || null;
}

function listAll() {
  // LEFT JOIN teams so the Admin Tools Users tab can show team membership
  // without a second query per row. team_name is null when the user has no
  // team (allowed by the schema).
  return getDb().prepare(`
    SELECT u.*, t.name AS team_name
    FROM users u
    LEFT JOIN teams t ON t.id = u.team_id
    ORDER BY u.created_at ASC
  `).all();
}

function create({ email, password_hash, display_name, role, team_id }) {
  const info = getDb().prepare(`
    INSERT INTO users (email, password_hash, display_name, role, team_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    String(email).toLowerCase(),
    password_hash,
    display_name || null,
    role,
    team_id || null
  );
  return findById(info.lastInsertRowid);
}

function update(id, patch) {
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (!fields.length) return findById(id);
  fields.push("updated_at = datetime('now')");
  values.push(id);
  getDb().prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return findById(id);
}

function recordLogin(id) {
  getDb().prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(id);
}

function remove(id) {
  return getDb().prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0;
}

module.exports = { findById, findByEmail, listAll, create, update, recordLogin, remove };
