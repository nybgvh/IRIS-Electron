const { getDb } = require('../db/connection');

function findById(id) {
  return getDb()
    .prepare('SELECT * FROM projects WHERE id = ? AND archived_at IS NULL')
    .get(id) || null;
}

function listForUser(userId) {
  return getDb().prepare(`
    SELECT p.*
    FROM projects p
    JOIN project_members m ON m.project_id = p.id
    WHERE m.user_id = ? AND p.archived_at IS NULL
    ORDER BY p.updated_at DESC
  `).all(userId);
}

function listAll() {
  return getDb()
    .prepare('SELECT * FROM projects WHERE archived_at IS NULL ORDER BY updated_at DESC')
    .all();
}

function create({ name, description, owner_id }) {
  const info = getDb().prepare(`
    INSERT INTO projects (name, description, owner_id) VALUES (?, ?, ?)
  `).run(name, description || null, owner_id);
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
  getDb().prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return findById(id);
}

function archive(id) {
  return getDb()
    .prepare("UPDATE projects SET archived_at = datetime('now') WHERE id = ?")
    .run(id).changes > 0;
}

module.exports = { findById, listForUser, listAll, create, update, archive };
