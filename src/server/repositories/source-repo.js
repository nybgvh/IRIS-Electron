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
  row.flagged = !!row.flagged;
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

// The dedup key for duplicate-upload detection: hash of the ORIGINAL uploaded
// bytes (see 014_source_upload_hash.sql).
function findByUploadHash(projectId, uploadHash) {
  if (!uploadHash) return null;
  return hydrate(getDb().prepare(`
    SELECT * FROM sources WHERE project_id = ? AND upload_sha256 = ?
    ORDER BY created_at ASC LIMIT 1
  `).get(projectId, uploadHash));
}

// Of the given upload hashes, which already exist in the project (for the
// pre-upload duplicate check). Returns the subset that is present.
function existingUploadHashes(projectId, hashes) {
  const list = [...new Set((hashes || []).filter(Boolean))];
  if (!list.length) return [];
  const placeholders = list.map(() => '?').join(',');
  return getDb().prepare(`
    SELECT DISTINCT upload_sha256 FROM sources
    WHERE project_id = ? AND upload_sha256 IN (${placeholders})
  `).all(projectId, ...list).map(r => r.upload_sha256);
}

function create(row) {
  const info = getDb().prepare(`
    INSERT INTO sources
      (project_id, uploaded_by, source_type, filename, storage_path,
       mime_type, byte_size, sha256, upload_sha256, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.project_id,
    row.uploaded_by || null,
    row.source_type,
    row.filename,
    row.storage_path,
    row.mime_type || null,
    row.byte_size || null,
    row.sha256 || null,
    row.upload_sha256 || null,
    row.metadata_json ? JSON.stringify(row.metadata_json) : null
  );
  return findById(info.lastInsertRowid);
}

function setFlag(id, flagged) {
  return getDb().prepare('UPDATE sources SET flagged = ? WHERE id = ?')
    .run(flagged ? 1 : 0, id).changes > 0;
}

function remove(id) {
  return getDb().prepare('DELETE FROM sources WHERE id = ?').run(id).changes > 0;
}

// Move a source to another project: re-key project_id + storage_path and drop
// its tags (tag ids belong to the old project's vocabulary). One transaction.
function reassignProject(id, newProjectId, newStoragePath) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE sources SET project_id = ?, storage_path = ? WHERE id = ?
    `).run(newProjectId, newStoragePath, id);
    db.prepare('DELETE FROM source_tags WHERE source_id = ?').run(id);
  });
  tx();
  return findById(id);
}

module.exports = {
  findById, listForProject, findByHash, findByUploadHash, existingUploadHashes,
  create, remove, reassignProject, setFlag,
};
