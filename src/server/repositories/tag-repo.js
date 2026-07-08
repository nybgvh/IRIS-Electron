/*
 * Tag repository. Project-scoped tags (009_tags.sql) and their attachment to
 * sources via the source_tags join. SQL stays here; authorization + name
 * normalization live in tag-service.
 */

const { getDb } = require('../db/connection');

function findById(id) {
  return getDb().prepare('SELECT * FROM tags WHERE id = ?').get(id) || null;
}

function findByName(projectId, name) {
  return getDb().prepare(
    'SELECT * FROM tags WHERE project_id = ? AND name = ?'
  ).get(projectId, name) || null;
}

// Tags for a project, each with a usage count for facet chips.
function listForProject(projectId) {
  return getDb().prepare(`
    SELECT t.*, COUNT(st.source_id) AS usage_count
    FROM tags t
    LEFT JOIN source_tags st ON st.tag_id = t.id
    WHERE t.project_id = ?
    GROUP BY t.id
    ORDER BY t.name COLLATE NOCASE ASC
  `).all(projectId);
}

function create({ project_id, name, color }) {
  const info = getDb().prepare(
    'INSERT INTO tags (project_id, name, color) VALUES (?, ?, ?)'
  ).run(project_id, name, color || null);
  return findById(info.lastInsertRowid);
}

function update(id, patch) {
  const fields = [];
  const values = [];
  if (patch.name !== undefined)  { fields.push('name = ?');  values.push(patch.name); }
  if (patch.color !== undefined) { fields.push('color = ?'); values.push(patch.color); }
  if (!fields.length) return findById(id);
  values.push(id);
  getDb().prepare(`UPDATE tags SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return findById(id);
}

function remove(id) {
  // source_tags rows cascade via FK ON DELETE CASCADE.
  return getDb().prepare('DELETE FROM tags WHERE id = ?').run(id).changes > 0;
}

// --- attachment ----------------------------------------------------------

function assign(sourceId, tagId, addedBy) {
  // Idempotent: re-tagging is a no-op thanks to the composite PK.
  getDb().prepare(`
    INSERT OR IGNORE INTO source_tags (source_id, tag_id, added_by)
    VALUES (?, ?, ?)
  `).run(sourceId, tagId, addedBy || null);
  return true;
}

function unassign(sourceId, tagId) {
  return getDb().prepare(
    'DELETE FROM source_tags WHERE source_id = ? AND tag_id = ?'
  ).run(sourceId, tagId).changes > 0;
}

function tagsForSource(sourceId) {
  return getDb().prepare(`
    SELECT t.* FROM tags t
    JOIN source_tags st ON st.tag_id = t.id
    WHERE st.source_id = ?
    ORDER BY t.name COLLATE NOCASE ASC
  `).all(sourceId);
}

module.exports = {
  findById,
  findByName,
  listForProject,
  create,
  update,
  remove,
  assign,
  unassign,
  tagsForSource,
};
