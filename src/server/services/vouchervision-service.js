/*
 * VoucherVision record service.
 *
 * The extraction pipeline itself lives in vouchervision/queue.js (triggered
 * automatically on upload). This service owns the record rows: listing them,
 * fetching one item's result for the Library, re-running extraction on
 * demand, and deleting (with on-disk artifact cleanup).
 */

const vvRepo = require('../repositories/vouchervision-repo');
const sourceRepo = require('../repositories/source-repo');
const projectService = require('./project-service');
const fileStore = require('../storage/file-store');
const config = require('../config');
const { CAPS } = require('../../shared/capabilities');
const { NotFoundError, ValidationError } = require('../errors');

function list(currentUser, projectId) {
  projectService.requireCap(projectId, currentUser, CAPS.PROJECT_VIEW);
  return vvRepo.listForProject(projectId);
}

// The extraction result for one source (Library item detail / status polling).
// Returns null when the source hasn't been processed yet.
function getForSource(currentUser, sourceId) {
  const src = sourceRepo.findById(sourceId);
  if (!src) throw new NotFoundError('Source not found.');
  projectService.requireCap(src.project_id, currentUser, CAPS.PROJECT_VIEW);
  return vvRepo.findBySource(sourceId);
}

function create(currentUser, projectId, payload) {
  projectService.requireCap(projectId, currentUser, CAPS.VOUCHERVISION_RUN);
  return vvRepo.create({
    project_id: projectId,
    source_id: payload.source_id || null,
    storage_path: payload.storage_path,
    status: payload.status || 'pending',
    created_by: currentUser.id,
  });
}

/*
 * Re-run VoucherVisionGO on an already-uploaded source. Clears the prior
 * artifacts (on disk + columns) and flips the record back to 'pending' (or
 * creates one if none exists), then wakes the queue. No-op-safe when the VV
 * integration is disabled.
 */
function reprocess(currentUser, sourceId) {
  const src = sourceRepo.findById(sourceId);
  if (!src) throw new NotFoundError('Source not found.');
  projectService.requireCap(src.project_id, currentUser, CAPS.VOUCHERVISION_RUN);
  if (!config.hasVouchervision()) {
    throw new ValidationError('VoucherVision is not configured on this server.');
  }

  let rec = vvRepo.findBySource(sourceId);
  if (rec) {
    fileStore.deleteVouchervisionArtifacts(rec.project_id, rec.id);
    vvRepo.markPending(rec.id);
  } else {
    rec = vvRepo.create({
      project_id: src.project_id,
      source_id: src.id,
      storage_path: `projects/${src.project_id}/vouchervision/pending-${src.id}.json`,
      status: 'pending',
      created_by: currentUser.id,
    });
  }
  const vvQueue = require('../vouchervision/queue');
  vvQueue.enqueue({ projectId: src.project_id, sourceId: src.id, createdBy: currentUser.id });
  return vvRepo.findById(rec.id);
}

function remove(currentUser, id) {
  const row = vvRepo.findById(id);
  if (!row) throw new NotFoundError('Record not found.');
  projectService.requireCap(row.project_id, currentUser, CAPS.VOUCHERVISION_RUN);
  fileStore.deleteVouchervisionArtifacts(row.project_id, row.id);
  return { ok: vvRepo.remove(id) };
}

module.exports = { list, getForSource, create, reprocess, remove };
