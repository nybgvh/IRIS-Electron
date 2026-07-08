const { getDb } = require('../db/connection');

// Parse payload_json into `payload` so callers (and the UI) get the sections
// object directly. Mirrors source-repo.hydrate.
function hydrate(row) {
  if (!row) return null;
  let payload = null;
  if (row.payload_json) {
    try { payload = JSON.parse(row.payload_json); } catch (_) { payload = null; }
  }
  row.payload = payload;
  return row;
}

function findById(id) {
  return hydrate(getDb().prepare('SELECT * FROM assessments WHERE id = ?').get(id) || null);
}

function listForProject(projectId) {
  return getDb().prepare(`
    SELECT * FROM assessments
    WHERE project_id = ?
    ORDER BY created_at DESC, version DESC
  `).all(projectId).map(hydrate);
}

// Next version number within a series (1 if the series is new/empty).
function nextVersion(projectId, seriesId) {
  if (!seriesId) return 1;
  const row = getDb().prepare(`
    SELECT MAX(version) AS v FROM assessments
    WHERE project_id = ? AND series_id = ?
  `).get(projectId, seriesId);
  return (row && row.v ? row.v : 0) + 1;
}

// First run in a series has series_id = its own id; the service sets it after
// insert via this helper.
function setSeries(id, seriesId) {
  return getDb().prepare('UPDATE assessments SET series_id = ? WHERE id = ?')
    .run(seriesId, id).changes > 0;
}

function create(row) {
  const info = getDb().prepare(`
    INSERT INTO assessments
      (project_id, scientific_name, iucn_category, iucn_criteria,
       storage_path, payload_json, status, created_by,
       generated_by_model, generated_at, series_id, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.project_id,
    row.scientific_name || null,
    row.iucn_category || null,
    row.iucn_criteria || null,
    row.storage_path || null,
    row.payload_json ? JSON.stringify(row.payload_json) : null,
    row.status || 'draft',
    row.created_by || null,
    row.generated_by_model || null,
    row.generated_at || null,
    row.series_id || null,
    row.version || 1
  );
  return findById(info.lastInsertRowid);
}

// Provenance: record which sources fed a generated assessment.
function setSources(assessmentId, sourceIds) {
  const insert = getDb().prepare(`
    INSERT OR IGNORE INTO assessment_sources (assessment_id, source_id)
    VALUES (?, ?)
  `);
  const tx = getDb().transaction((ids) => {
    for (const sid of ids) insert.run(assessmentId, sid);
  });
  tx((sourceIds || []).filter(Boolean));
}

function listSourceIds(assessmentId) {
  return getDb().prepare(
    'SELECT source_id FROM assessment_sources WHERE assessment_id = ? AND source_id IS NOT NULL'
  ).all(assessmentId).map(r => r.source_id);
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

module.exports = {
  findById, listForProject, create, update, remove,
  setSources, listSourceIds, nextVersion, setSeries,
};
