const { getDb } = require('../db/connection');

function findById(id) {
  return getDb().prepare('SELECT * FROM assessments WHERE id = ?').get(id) || null;
}

function listForProject(projectId) {
  return getDb().prepare(`
    SELECT * FROM assessments
    WHERE project_id = ?
    ORDER BY updated_at DESC
  `).all(projectId);
}

function create(row) {
  const info = getDb().prepare(`
    INSERT INTO assessments
      (project_id, scientific_name, iucn_category, iucn_criteria,
       storage_path, payload_json, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.project_id,
    row.scientific_name || null,
    row.iucn_category || null,
    row.iucn_criteria || null,
    row.storage_path || null,
    row.payload_json ? JSON.stringify(row.payload_json) : null,
    row.status || 'draft',
    row.created_by || null
  );
  return findById(info.lastInsertRowid);
}

function update(id, patch) {
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = ?`);
    values.push(k === 'payload_json' && v && typeof v !== 'string'
      ? JSON.stringify(v) : v);
  }
  if (!fields.length) return findById(id);
  fields.push("updated_at = datetime('now')");
  values.push(id);
  getDb().prepare(`UPDATE assessments SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return findById(id);
}

function remove(id) {
  return getDb().prepare('DELETE FROM assessments WHERE id = ?').run(id).changes > 0;
}

module.exports = { findById, listForProject, create, update, remove };
