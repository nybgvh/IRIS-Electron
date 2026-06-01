/*
 * VoucherVision record service. Phase 0 only persists rows produced by the
 * (future) extraction pipeline; running the pipeline itself is out of scope
 * for the bare-bones scaffold.
 */

const vvRepo = require('../repositories/vouchervision-repo');
const projectService = require('./project-service');
const { CAPS } = require('../../shared/capabilities');
const { NotFoundError } = require('../errors');

function list(currentUser, projectId) {
  projectService.requireCap(projectId, currentUser, CAPS.PROJECT_VIEW);
  return vvRepo.listForProject(projectId);
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

function remove(currentUser, id) {
  const row = vvRepo.findById(id);
  if (!row) throw new NotFoundError('Record not found.');
  projectService.requireCap(row.project_id, currentUser, CAPS.VOUCHERVISION_RUN);
  return { ok: vvRepo.remove(id) };
}

module.exports = { list, create, remove };
