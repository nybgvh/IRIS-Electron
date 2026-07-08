/*
 * Source uploads. Writes the bytes to file storage, then records the row.
 * The two operations aren't transactional across DB + filesystem, so on a
 * partial failure we prefer "file written but no row" (orphan file — easy
 * to clean up) over "row but no file" (broken reference).
 */

const path = require('path');
const sourceRepo = require('../repositories/source-repo');
const vvRepo = require('../repositories/vouchervision-repo');
const tagRepo = require('../repositories/tag-repo');
const projectService = require('./project-service');
const fileStore = require('../storage/file-store');
const image = require('../storage/image');
const pdfPages = require('../vouchervision/pdf-pages');
const config = require('../config');
const { CAPS } = require('../../shared/capabilities');
const { SOURCE_TYPES, SOURCE_TYPE_LIST } = require('../../shared/source-types');
const { ValidationError, NotFoundError } = require('../errors');

// Only images go to VoucherVisionGO directly. PDFs / notebooks are rasterised
// to per-page JPGs at upload time (see uploadPdfPages) and each page becomes an
// ordinary image item — so the API only ever receives images, submitted in
// parallel by the queue (mirrors the Python client's convert-then-batch flow).
const VV_ELIGIBLE = new Set([SOURCE_TYPES.IMAGE]);

function maybeEnqueueVouchervision(row, currentUser) {
  // Server controls the pipeline — user has no say. Skip if disabled in
  // config or the source type isn't eligible.
  if (!config.hasVouchervision()) return;
  if (!VV_ELIGIBLE.has(row.source_type)) return;
  try {
    vvRepo.create({
      project_id: row.project_id,
      source_id: row.id,
      // Placeholder until the worker writes the result. The schema requires
      // storage_path NOT NULL; this is the path the worker will overwrite.
      storage_path: `projects/${row.project_id}/vouchervision/pending-${row.id}.json`,
      status: 'pending',
      created_by: currentUser.id,
    });
    // Wake the queue immediately. Lazy-require avoids loading the worker
    // (which dynamically imports pdf-to-img) in environments that don't
    // need it, like unit tests of source-service.
    const vvQueue = require('../vouchervision/queue');
    vvQueue.enqueue({ projectId: row.project_id, sourceId: row.id, createdBy: currentUser.id });
  } catch (err) {
    // Enqueue failures must not fail the upload — the source row is already
    // committed and the user shouldn't be punished for a downstream issue.
    console.error('[source-service] failed to enqueue vouchervision job:', err);
  }
}

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

// Which of the given raw-upload hashes are already in the project. Powers the
// renderer's pre-upload duplicate check.
function checkDuplicates(currentUser, projectId, hashes) {
  projectService.requireCap(projectId, currentUser, CAPS.SOURCE_UPLOAD);
  return sourceRepo.existingUploadHashes(projectId, hashes || []);
}

async function upload(currentUser, projectId, { filename, mime_type, buffer, source_type, metadata, force }) {
  projectService.requireCap(projectId, currentUser, CAPS.SOURCE_UPLOAD);
  if (!filename || !buffer) {
    throw new ValidationError('filename and file content are required.');
  }
  if (!SOURCE_TYPE_LIST.includes(source_type)) {
    throw new ValidationError('Invalid source type.');
  }
  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  // PDFs and field notebooks are exploded into per-page image items in-app; the
  // API only ever sees images (see uploadPdfPages).
  if (source_type === SOURCE_TYPES.PDF || source_type === SOURCE_TYPES.NOTEBOOK) {
    return uploadPdfPages(currentUser, projectId, { raw, filename, origin: source_type, force });
  }

  // A single specimen image.
  return saveImageSource(currentUser, projectId, {
    filename, mimeType: mime_type, rawBuffer: raw, metadata, force,
  });
}

/*
 * Save one specimen image as a source: dedup on the raw-upload hash (unless
 * forced), downsample to the canonical ≤20 MP JPEG, store it, insert the row,
 * and enqueue VoucherVision. Returns the created (or existing) row. Shared by
 * direct image uploads AND by each rasterised PDF page.
 */
async function saveImageSource(currentUser, projectId, { filename, mimeType, rawBuffer, metadata, force }) {
  const raw = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);
  // Dedup key = hash of the ORIGINAL bytes (matches the client's Web Crypto
  // hash and, for PDF pages, is deterministic so re-uploading a PDF dedups).
  const uploadHash = fileStore.sha256(raw);
  if (!force) {
    const existing = sourceRepo.findByUploadHash(projectId, uploadHash);
    if (existing) return existing;
  }

  let buf = raw;
  let storedMime = mimeType;
  let storedName = filename;
  let extraMeta = null;
  // Transcode/downsample to the canonical ≤20 MP JPEG. Decode failure falls
  // back to storing the original bytes so a weird format never blocks upload.
  try {
    const jpeg = await image.downsampleToJpeg(buf);
    buf = jpeg.buffer;
    storedMime = 'image/jpeg';
    storedName = replaceExt(filename, '.jpg');
    extraMeta = { width: jpeg.width, height: jpeg.height, downsampled: true };
  } catch (err) {
    console.error('[source-service] image downsample failed, storing original:', err && err.message);
  }

  // A forced duplicate gets its own file so deleting one copy never removes the
  // other's bytes.
  const { storage_path, sha256, byte_size } =
    fileStore.saveSource(projectId, storedName, buf, { unique: !!force });

  const baseMeta = metadata || defaultMetadata(storedName, SOURCE_TYPES.IMAGE);
  const row = sourceRepo.create({
    project_id: projectId,
    uploaded_by: currentUser.id,
    source_type: SOURCE_TYPES.IMAGE,
    filename: storedName,
    storage_path,
    mime_type: storedMime,
    byte_size,
    sha256,
    upload_sha256: uploadHash,
    metadata_json: extraMeta ? { ...baseMeta, ...extraMeta } : baseMeta,
  });

  autoTagSource(currentUser, projectId, row.id, baseMeta);
  maybeEnqueueVouchervision(row, currentUser);
  return row;
}

/*
 * Provenance tags: every item gets a tag for WHERE it came from, so the Library
 * can filter by source. GBIF imports → "GBIF"; everything else the user provided
 * (direct images, PDF/notebook pages) → "User Upload". Future external sources
 * set metadata.imported_from and get their own tag here automatically.
 */
const SOURCE_TAGS = {
  gbif: { name: 'GBIF', color: '#0098c3' },
};
function sourceTagFor(metadata) {
  const from = metadata && metadata.imported_from;
  if (from) return SOURCE_TAGS[from] || { name: String(from).toUpperCase(), color: null };
  return { name: 'User Upload', color: '#6d7b32' };
}
function autoTagSource(currentUser, projectId, sourceId, metadata) {
  try {
    const { name, color } = sourceTagFor(metadata);
    let tag = tagRepo.findByName(projectId, name);
    if (!tag) tag = tagRepo.create({ project_id: projectId, name, color });
    tagRepo.assign(sourceId, tag.id, currentUser.id);
  } catch (err) {
    // Tagging must never fail an upload/import.
    console.error('[source-service] auto-tag failed:', err && err.message);
  }
}

/*
 * Rasterise a PDF / notebook into per-page JPEGs IN THE APP, then save each
 * page as an ordinary image item (which the queue submits to /process in
 * parallel). No PDF ever reaches the VoucherVisionGO API. Returns
 * { pdf: true, filename, pageCount, pages }.
 */
async function uploadPdfPages(currentUser, projectId, { raw, filename, origin, force }) {
  const stem = path.parse(filename).name;
  const pages = [];
  let seen = 0;
  try {
    for await (const page of pdfPages.renderPagesFromBuffer(raw, {
      dpi: config.vouchervision.pdfDpi,
      originalFilename: filename,
    })) {
      seen += 1;
      const pageName = `${stem}_page_${String(page.pageNumber).padStart(4, '0')}.jpg`;
      const meta = defaultMetadata(pageName, SOURCE_TYPES.IMAGE);
      meta.origin = origin;             // 'pdf' | 'notebook'
      meta.source_pdf = filename;
      meta.page_number = page.pageNumber;
      // page.buffer is PNG; saveImageSource downsamples it to JPEG.
      const row = await saveImageSource(currentUser, projectId, {
        filename: pageName, mimeType: page.mimeType, rawBuffer: page.buffer, metadata: meta, force,
      });
      if (row) pages.push(row);
    }
  } catch (err) {
    throw new ValidationError(`Could not read PDF "${filename}": ${err && err.message || err}`);
  }
  if (seen === 0) throw new ValidationError(`"${filename}" has no pages.`);
  return { pdf: true, filename, pageCount: pages.length, pages };
}

// Delete a source AND everything derived from it: its VoucherVision record(s)
// (rows + on-disk JSON + derived JPGs) and the stored source file. Fixes the
// prior orphaned-artifact gap (FK only SET NULL'd source_id).
function remove(currentUser, sourceId) {
  const src = sourceRepo.findById(sourceId);
  if (!src) throw new NotFoundError('Source not found.');
  projectService.requireCap(src.project_id, currentUser, CAPS.SOURCE_DELETE);

  const rec = vvRepo.findBySource(sourceId);
  if (rec) {
    fileStore.deleteVouchervisionArtifacts(rec.project_id, rec.id);
    vvRepo.remove(rec.id);
  }
  // Also drop any external-source reference rows (GBIF, …) so they don't orphan
  // and block re-import. (project_sources_* tables FK to sources SET NULL.)
  require('../repositories/gbif-source-repo').removeBySource(sourceId);
  fileStore.deleteFile(src.storage_path);
  return { ok: sourceRepo.remove(sourceId) };
}

// Move an item to another project the user can upload to. Re-keys the source
// and its VV record, and physically relocates the stored file. Tags are
// project-scoped, so they drop on move (join rows cascade with the source
// staying, but the tag ids belong to the old project — we clear them).
function move(currentUser, sourceId, targetProjectId) {
  const src = sourceRepo.findById(sourceId);
  if (!src) throw new NotFoundError('Source not found.');
  projectService.requireCap(src.project_id, currentUser, CAPS.SOURCE_DELETE);
  projectService.requireCap(targetProjectId, currentUser, CAPS.SOURCE_UPLOAD);
  if (Number(targetProjectId) === Number(src.project_id)) return src;
  const oldProjectId = src.project_id;

  // Capture the VV record before re-keying so we know which files to relocate.
  const rec = vvRepo.findBySource(sourceId);

  const newPath = fileStore.moveSource(src.storage_path, targetProjectId, src.filename);
  sourceRepo.reassignProject(sourceId, targetProjectId, newPath);

  if (rec) {
    vvRepo.reassignProject(sourceId, targetProjectId);
    // Storage paths embed the project id — relocate the record's JSON + JPGs
    // and repoint its path columns, else delete/serve would look in the old
    // project's tree.
    const moved = fileStore.moveVouchervisionArtifacts(oldProjectId, targetProjectId, rec.id);
    vvRepo.setPaths(rec.id, moved);
  }
  return sourceRepo.findById(sourceId);
}

// Toggle the shared "flag" marker on an item. Gated like tagging (owner/editor)
// since it's a project-visible annotation.
function setFlag(currentUser, sourceId, flagged) {
  const src = sourceRepo.findById(sourceId);
  if (!src) throw new NotFoundError('Source not found.');
  projectService.requireCap(src.project_id, currentUser, CAPS.SOURCE_TAG);
  sourceRepo.setFlag(sourceId, flagged);
  return sourceRepo.findById(sourceId);
}

// Replace a filename's extension (keeps directory-free display name intact).
function replaceExt(name, ext) {
  const dot = String(name).lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}${ext}`;
}

// Save an already-fetched image (e.g. downloaded from an external source like
// GBIF) as a Library item — same pipeline as a direct upload: dedup, downsample
// to the canonical ≤20 MP JPEG, store, insert the row, enqueue VoucherVision.
// The caller supplies the bytes and metadata; there is no HTTP upload envelope.
async function saveImage(currentUser, projectId, { filename, mimeType, buffer, metadata, force }) {
  projectService.requireCap(projectId, currentUser, CAPS.SOURCE_UPLOAD);
  if (!filename || !buffer) throw new ValidationError('filename and image bytes are required.');
  return saveImageSource(currentUser, projectId, {
    filename, mimeType: mimeType || 'image/jpeg', rawBuffer: buffer, metadata, force,
  });
}

module.exports = { list, upload, remove, move, setFlag, checkDuplicates, saveImage };
