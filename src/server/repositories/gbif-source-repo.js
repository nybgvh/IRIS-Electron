/*
 * project_sources_gbif read/write model — GBIF occurrences imported into a
 * project (see migration 015). One row per imported occurrence, linked to the
 * Library image it produced (source_id).
 *
 * `raw_json` is stored as text and parsed on read into `raw`.
 */

const { getDb } = require('../db/connection');

function hydrate(row) {
  if (!row) return null;
  let raw = null;
  if (row.raw_json) { try { raw = JSON.parse(row.raw_json); } catch (_) { raw = null; } }
  row.raw = raw;
  return row;
}

function create(rec) {
  const info = getDb().prepare(`
    INSERT INTO project_sources_gbif
      (project_id, source_id, gbif_id, occurrence_url, image_url, citation,
       scientific_name, dataset_key, dataset_title, dataset_doi, publisher,
       catalog_number, country, latitude, longitude, raw_json, created_by)
    VALUES
      (@project_id, @source_id, @gbif_id, @occurrence_url, @image_url, @citation,
       @scientific_name, @dataset_key, @dataset_title, @dataset_doi, @publisher,
       @catalog_number, @country, @latitude, @longitude, @raw_json, @created_by)
  `).run({
    project_id: rec.project_id,
    source_id: rec.source_id ?? null,
    gbif_id: String(rec.gbif_id),
    occurrence_url: rec.occurrence_url ?? null,
    image_url: rec.image_url ?? null,
    citation: rec.citation ?? null,
    scientific_name: rec.scientific_name ?? null,
    dataset_key: rec.dataset_key ?? null,
    dataset_title: rec.dataset_title ?? null,
    dataset_doi: rec.dataset_doi ?? null,
    publisher: rec.publisher ?? null,
    catalog_number: rec.catalog_number ?? null,
    country: rec.country ?? null,
    latitude: rec.latitude ?? null,
    longitude: rec.longitude ?? null,
    raw_json: rec.raw_json ?? null,
    created_by: rec.created_by ?? null,
  });
  return findById(info.lastInsertRowid);
}

function findById(id) {
  return hydrate(getDb().prepare('SELECT * FROM project_sources_gbif WHERE id = ?').get(id));
}

function findByGbifId(projectId, gbifId) {
  return hydrate(getDb().prepare(
    'SELECT * FROM project_sources_gbif WHERE project_id = ? AND gbif_id = ?'
  ).get(projectId, String(gbifId)));
}

function listForProject(projectId) {
  return getDb().prepare(
    'SELECT * FROM project_sources_gbif WHERE project_id = ? ORDER BY created_at DESC, id DESC'
  ).all(projectId).map(hydrate);
}

function remove(id) {
  return getDb().prepare('DELETE FROM project_sources_gbif WHERE id = ?').run(id).changes > 0;
}

// Remove any GBIF reference rows linked to a source (called when the Library
// image is deleted, so the citation row doesn't orphan and block re-import).
function removeBySource(sourceId) {
  return getDb().prepare('DELETE FROM project_sources_gbif WHERE source_id = ?').run(sourceId).changes;
}

// --- saved GBIF searches (bookmarks) ---------------------------------------

function createBookmark(rec) {
  const info = getDb().prepare(`
    INSERT INTO project_gbif_bookmarks (project_id, url, label, created_by)
    VALUES (@project_id, @url, @label, @created_by)
  `).run({
    project_id: rec.project_id,
    url: rec.url,
    label: rec.label ?? null,
    created_by: rec.created_by ?? null,
  });
  return findBookmarkById(info.lastInsertRowid);
}

function findBookmarkById(id) {
  return getDb().prepare('SELECT * FROM project_gbif_bookmarks WHERE id = ?').get(id) || null;
}

function findBookmarkByUrl(projectId, url) {
  return getDb().prepare(
    'SELECT * FROM project_gbif_bookmarks WHERE project_id = ? AND url = ?'
  ).get(projectId, url) || null;
}

function listBookmarks(projectId) {
  return getDb().prepare(
    'SELECT * FROM project_gbif_bookmarks WHERE project_id = ? ORDER BY created_at DESC, id DESC'
  ).all(projectId);
}

function removeBookmark(id) {
  return getDb().prepare('DELETE FROM project_gbif_bookmarks WHERE id = ?').run(id).changes > 0;
}

module.exports = {
  create, findById, findByGbifId, listForProject, remove, removeBySource,
  createBookmark, findBookmarkById, findBookmarkByUrl, listBookmarks, removeBookmark,
};
