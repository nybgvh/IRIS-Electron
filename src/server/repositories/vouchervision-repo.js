const { getDb } = require('../db/connection');

function findById(id) {
  return getDb()
    .prepare('SELECT * FROM vouchervision_records WHERE id = ?')
    .get(id) || null;
}

function listForProject(projectId) {
  return getDb().prepare(`
    SELECT * FROM vouchervision_records
    WHERE project_id = ?
    ORDER BY created_at DESC
  `).all(projectId);
}

function create(row) {
  const info = getDb().prepare(`
    INSERT INTO vouchervision_records
      (project_id, source_id, storage_path, status, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    row.project_id,
    row.source_id || null,
    row.storage_path,
    row.status || 'pending',
    row.created_by || null
  );
  return findById(info.lastInsertRowid);
}

function updateStatus(id, status) {
  return getDb().prepare(`
    UPDATE vouchervision_records
    SET status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, id).changes > 0;
}

// Queue helpers — kept here so SQL never leaks into the worker.

function listPending() {
  return getDb().prepare(`
    SELECT id, source_id FROM vouchervision_records
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `).all();
}

function setComplete(id, storagePath) {
  return getDb().prepare(`
    UPDATE vouchervision_records
    SET storage_path = ?, status = 'complete', updated_at = datetime('now')
    WHERE id = ?
  `).run(storagePath, id).changes > 0;
}

function setErrored(id, storagePath) {
  return getDb().prepare(`
    UPDATE vouchervision_records
    SET storage_path = ?, status = 'errored', updated_at = datetime('now')
    WHERE id = ?
  `).run(storagePath, id).changes > 0;
}

function remove(id) {
  return getDb().prepare('DELETE FROM vouchervision_records WHERE id = ?')
    .run(id).changes > 0;
}

module.exports = {
  findById,
  listForProject,
  create,
  updateStatus,
  listPending,
  setComplete,
  setErrored,
  remove,
};
