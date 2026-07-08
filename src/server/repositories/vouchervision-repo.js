const { getDb } = require('../db/connection');

// Parse the inline formatted_json string into a real object (schema-on-read),
// mirroring source-repo.hydrate. Mutates in place — better-sqlite3 rows are
// plain objects. The raw string stays on `formatted_json` too so callers that
// want the text (e.g. re-serializing) still have it.
function hydrate(row) {
  if (!row) return null;
  let parsed = null;
  if (row.formatted_json) {
    try { parsed = JSON.parse(row.formatted_json); } catch (_) { parsed = null; }
  }
  row.formatted = parsed;
  return row;
}

function findById(id) {
  return hydrate(getDb()
    .prepare('SELECT * FROM vouchervision_records WHERE id = ?')
    .get(id) || null);
}

// The record derived from a given source. A source has at most one live
// record in this pass (reprocess overwrites the same row), so `.get` is right.
function findBySource(sourceId) {
  if (!sourceId) return null;
  return hydrate(getDb().prepare(`
    SELECT * FROM vouchervision_records
    WHERE source_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sourceId) || null);
}

function listForProject(projectId) {
  return getDb().prepare(`
    SELECT * FROM vouchervision_records
    WHERE project_id = ?
    ORDER BY created_at DESC
  `).all(projectId).map(hydrate);
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

// Move a record back to 'pending' so the queue re-runs it. Clears the prior
// extraction so stale text/images never linger next to a failed re-run.
function markPending(id) {
  return getDb().prepare(`
    UPDATE vouchervision_records
    SET status = 'pending',
        ocr_text = NULL, formatted_json = NULL, scientific_name = NULL,
        image_full_path = NULL, image_cropped_path = NULL, error_message = NULL,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(id).changes > 0;
}

// Queue helpers — kept here so SQL never leaks into the worker.

function listPending() {
  return getDb().prepare(`
    SELECT id, source_id FROM vouchervision_records
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `).all();
}

/*
 * Mark a record complete and persist the split-out artifacts. `fields`:
 *   storage_path       — the raw /process response JSON (provenance)
 *   ocr_text           — the OCR string
 *   formatted_json     — the structured record (object or string; stored as text)
 *   scientific_name    — denormalized for list/sort/roll-up
 *   image_full_path    — decoded full-size JPG
 *   image_cropped_path — decoded cropped label JPG
 */
function setComplete(id, fields = {}) {
  const fj = fields.formatted_json;
  const formattedText = fj == null ? null
    : (typeof fj === 'string' ? fj : JSON.stringify(fj));
  return getDb().prepare(`
    UPDATE vouchervision_records
    SET storage_path = ?, status = 'complete',
        ocr_text = ?, formatted_json = ?, scientific_name = ?,
        image_full_path = ?, image_cropped_path = ?, error_message = NULL,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    fields.storage_path,
    fields.ocr_text ?? null,
    formattedText,
    fields.scientific_name ?? null,
    fields.image_full_path ?? null,
    fields.image_cropped_path ?? null,
    id
  ).changes > 0;
}

function setErrored(id, storagePath, message) {
  return getDb().prepare(`
    UPDATE vouchervision_records
    SET storage_path = ?, status = 'errored', error_message = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(storagePath, message ?? null, id).changes > 0;
}

// Re-key a source's records to a new project (item move — see source-service).
function reassignProject(sourceId, newProjectId) {
  return getDb().prepare(`
    UPDATE vouchervision_records
    SET project_id = ?, updated_at = datetime('now')
    WHERE source_id = ?
  `).run(newProjectId, sourceId).changes;
}

// Point a record's on-disk paths at their new locations after an item move.
// Only overwrites a column when a new path is provided (a record may have no
// derived images).
function setPaths(id, { storage_path, image_full_path, image_cropped_path } = {}) {
  const sets = [];
  const vals = [];
  if (storage_path)       { sets.push('storage_path = ?');       vals.push(storage_path); }
  if (image_full_path)    { sets.push('image_full_path = ?');    vals.push(image_full_path); }
  if (image_cropped_path) { sets.push('image_cropped_path = ?'); vals.push(image_cropped_path); }
  if (!sets.length) return false;
  vals.push(id);
  return getDb().prepare(
    `UPDATE vouchervision_records SET ${sets.join(', ')} WHERE id = ?`
  ).run(...vals).changes > 0;
}

function remove(id) {
  return getDb().prepare('DELETE FROM vouchervision_records WHERE id = ?')
    .run(id).changes > 0;
}

module.exports = {
  findById,
  findBySource,
  listForProject,
  create,
  updateStatus,
  markPending,
  listPending,
  setComplete,
  setErrored,
  reassignProject,
  setPaths,
  remove,
};
