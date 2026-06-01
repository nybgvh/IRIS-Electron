/*
 * Red List assessment service.
 */

const assessmentRepo = require('../repositories/assessment-repo');
const projectService = require('./project-service');
const { CAPS } = require('../../shared/capabilities');
const { NotFoundError, ValidationError } = require('../errors');

function list(currentUser, projectId) {
  projectService.requireCap(projectId, currentUser, CAPS.PROJECT_VIEW);
  return assessmentRepo.listForProject(projectId);
}

function get(currentUser, id) {
  const row = assessmentRepo.findById(id);
  if (!row) throw new NotFoundError('Assessment not found.');
  projectService.requireCap(row.project_id, currentUser, CAPS.PROJECT_VIEW);
  return row;
}

function create(currentUser, projectId, payload) {
  projectService.requireCap(projectId, currentUser, CAPS.ASSESSMENT_EDIT);
  if (payload.storage_path && payload.payload_json) {
    throw new ValidationError('Provide either storage_path or payload_json, not both.');
  }
  return assessmentRepo.create({
    project_id: projectId,
    scientific_name: payload.scientific_name,
    iucn_category: payload.iucn_category,
    iucn_criteria: payload.iucn_criteria,
    storage_path: payload.storage_path,
    payload_json: payload.payload_json,
    status: payload.status,
    created_by: currentUser.id,
  });
}

function update(currentUser, id, patch) {
  const row = assessmentRepo.findById(id);
  if (!row) throw new NotFoundError('Assessment not found.');
  projectService.requireCap(row.project_id, currentUser, CAPS.ASSESSMENT_EDIT);
  return assessmentRepo.update(id, patch);
}

function remove(currentUser, id) {
  const row = assessmentRepo.findById(id);
  if (!row) throw new NotFoundError('Assessment not found.');
  projectService.requireCap(row.project_id, currentUser, CAPS.ASSESSMENT_EDIT);
  return { ok: assessmentRepo.remove(id) };
}

module.exports = { list, get, create, update, remove };
