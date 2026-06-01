const { getDb } = require('../db/connection');

function findById(id) {
  return getDb().prepare('SELECT * FROM teams WHERE id = ?').get(id) || null;
}

function findByName(name) {
  if (!name) return null;
  return getDb().prepare('SELECT * FROM teams WHERE name = ?').get(name) || null;
}

function listAll() {
  // Member count joined inline so the Admin Tools Teams tab doesn't need
  // a second query per row.
  return getDb().prepare(`
    SELECT t.*,
           (SELECT COUNT(*) FROM users u WHERE u.team_id = t.id) AS member_count
    FROM teams t
    ORDER BY t.name ASC
  `).all();
}

function create({ name, description }) {
  const info = getDb().prepare(`
    INSERT INTO teams (name, description) VALUES (?, ?)
  `).run(name, description || null);
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
  getDb().prepare(`UPDATE teams SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return findById(id);
}

function remove(id) {
  return getDb().prepare('DELETE FROM teams WHERE id = ?').run(id).changes > 0;
}

function listMembers(teamId) {
  return getDb().prepare(`
    SELECT id, email, display_name, role, team_id, last_login_at, created_at
    FROM users
    WHERE team_id = ?
    ORDER BY display_name COLLATE NOCASE, email COLLATE NOCASE
  `).all(teamId);
}

function listTeammates(teamId, excludeUserId) {
  // Used by the project member picker. Returns the lightweight shape the
  // renderer dropdown needs.
  if (!teamId) return [];
  return getDb().prepare(`
    SELECT id, email, display_name
    FROM users
    WHERE team_id = ? AND id <> ?
    ORDER BY display_name COLLATE NOCASE, email COLLATE NOCASE
  `).all(teamId, excludeUserId);
}

module.exports = {
  findById, findByName, listAll, create, update, remove,
  listMembers, listTeammates,
};
