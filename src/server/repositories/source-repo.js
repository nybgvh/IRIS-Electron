const { getDb } = require('../db/connection');

// Parse the metadata_json string into a real object so consumers don't have
// to repeat the JSON.parse + null-check dance. Mutates in place — rows from
// better-sqlite3 are plain objects, not connected to the DB.
function hydrate(row) {
  if (!row) return null;
  let meta = {};
  if (row.metadata_json) {
    try { meta = JSON.parse(row.metadata_json); } catch (_) { meta = {}; }
  }
  row.metadata = meta;
  return row;
}

function findById(id) {
  return hydrate(getDb().prepare('SELECT * FROM sources WHERE id = ?').get(id));
}

function listForProject(projectId, { type } = {}) {
  const rows = type
    ? getDb().prepare(`
        SELECT * FROM sources WHERE project_id = ? AND source_type = ?
        ORDER BY created_at DESC
      `).all(projectId, type)
    : getDb().prepare(`
        SELECT * FROM sources WHERE project_id = ? ORDER BY created_at DESC
      `).all(projectId);
  return rows.map(hydrate);
}

function findByHash(projectId, sha256) {
  if (!sha256) return null;
  return hydrate(getDb().prepare(`
    SELECT * FROM sources WHERE project_id = ? AND sha256 = ?
  `).get(projectId, sha256));
}

function create(row) {
  const info = getDb().prepare(`
    INSERT INTO sources
      (project_id, uploaded_by, source_type, filename, storage_path,
       mime_type, byte_size, sha256, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.project_id,
    row.uploaded_by || null,
    row.source_type,
    row.filename,
    row.storage_path,
    row.mime_type || null,
    row.byte_size || null,
    row.sha256 || null,
    row.metadata_json ? JSON.stringify(row.metadata_json) : null
  );
  return findById(info.lastInsertRowid);
}

function remove(id) {
  return getDb().prepare('DELETE FROM sources WHERE id = ?').run(id).changes > 0;
}

module.exports = { findById, listForProject, findByHash, create, remove };
