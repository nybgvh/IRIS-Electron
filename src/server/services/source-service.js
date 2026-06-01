/*
 * Source uploads. Writes the bytes to file storage, then records the row.
 * The two operations aren't transactional across DB + filesystem, so on a
 * partial failure we prefer "file written but no row" (orphan file — easy
 * to clean up) over "row but no file" (broken reference).
 */

const sourceRepo = require('../repositories/source-repo');
const projectService = require('./project-service');
const fileStore = require('../storage/file-store');
const { CAPS } = require('../../shared/capabilities');
const { SOURCE_TYPES, SOURCE_TYPE_LIST } = require('../../shared/source-types');
const { ValidationError, NotFoundError } = require('../errors');

/*
 * Per-source-type metadata stubs. Attached at upload time so the JSON has
 * a stable shape the renderer can read without null-checking every key.
 * Schema-on-read: nothing in the DB enforces these fields; the renderer
 * fills them in (or extraction does, later).
 *
 * Ported from the Phase 0 Flask prototype's default_metadata().
 */
function defaultMetadata(filename, sourceType) {
  const common = {
    source_type: sourceType,
    source_file: filename,
    notes: null,
  };
  if (sourceType === SOURCE_TYPES.IMAGE) {
    return {
      ...common,
      scientific_name: null,
      common_name: null,
      family: null,
      collector: null,
      collection_date: null,
      locality: null,
      country: null,
      coordinates: { lat: null, lon: null },
      habitat: null,
      iucn: { category: null, assessment_year: null, assessor: null, criteria: null },
    };
  }
  if (sourceType === SOURCE_TYPES.NOTEBOOK) {
    return {
      ...common,
      collector: null,
      expedition: null,
      date_range: null,
      page_number: null,
      transcription: null,
      language_detected: null,
    };
  }
  if (sourceType === SOURCE_TYPES.PDF) {
    return {
      ...common,
      title: null,
      authors: null,
      year: null,
      publisher: null,
      doi: null,
      page_count: null,
      source_authority: null,
    };
  }
  return common;
}

function list(currentUser, projectId, { type } = {}) {
  projectService.requireCap(projectId, currentUser, CAPS.PROJECT_VIEW);
  return sourceRepo.listForProject(projectId, { type });
}

function upload(currentUser, projectId, { filename, mime_type, buffer, source_type, metadata }) {
  projectService.requireCap(projectId, currentUser, CAPS.SOURCE_UPLOAD);
  if (!filename || !buffer) {
    throw new ValidationError('filename and file content are required.');
  }
  if (!SOURCE_TYPE_LIST.includes(source_type)) {
    throw new ValidationError('Invalid source type.');
  }
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const { storage_path, sha256, byte_size } = fileStore.saveSource(projectId, filename, buf);

  // Dedup: if a file with the same hash already exists in this project,
  // return the existing row instead of inserting a duplicate.
  const existing = sourceRepo.findByHash(projectId, sha256);
  if (existing) return existing;

  return sourceRepo.create({
    project_id: projectId,
    uploaded_by: currentUser.id,
    source_type,
    filename,
    storage_path,
    mime_type,
    byte_size,
    sha256,
    metadata_json: metadata || defaultMetadata(filename, source_type),
  });
}

function remove(currentUser, sourceId) {
  const src = sourceRepo.findById(sourceId);
  if (!src) throw new NotFoundError('Source not found.');
  projectService.requireCap(src.project_id, currentUser, CAPS.SOURCE_DELETE);
  fileStore.deleteFile(src.storage_path);
  return { ok: sourceRepo.remove(sourceId) };
}

module.exports = { list, upload, remove };
