/*
 * Tag service. Project-scoped tags for the Library. Reading tags needs only
 * PROJECT_VIEW; creating/renaming/deleting and (un)assigning need SOURCE_TAG
 * (owner + editor). Names are trimmed and de-duplicated per project.
 */

const tagRepo = require('../repositories/tag-repo');
const sourceRepo = require('../repositories/source-repo');
const projectService = require('./project-service');
const { CAPS } = require('../../shared/capabilities');
const { ValidationError, NotFoundError, ForbiddenError } = require('../errors');

function normalizeName(name) {
  const n = String(name == null ? '' : name).trim();
  if (!n) throw new ValidationError('Tag name is required.');
  if (n.length > 60) throw new ValidationError('Tag name is too long (max 60).');
  return n;
}

function list(currentUser, projectId) {
  projectService.requireCap(projectId, currentUser, CAPS.PROJECT_VIEW);
  return tagRepo.listForProject(projectId);
}

function create(currentUser, projectId, { name, color }) {
  projectService.requireCap(projectId, currentUser, CAPS.SOURCE_TAG);
  const clean = normalizeName(name);
  const existing = tagRepo.findByName(projectId, clean);
  if (existing) return existing; // idempotent: reuse the existing tag
  return tagRepo.create({ project_id: projectId, name: clean, color });
}

function update(currentUser, tagId, patch) {
  const tag = tagRepo.findById(tagId);
  if (!tag) throw new NotFoundError('Tag not found.');
  projectService.requireCap(tag.project_id, currentUser, CAPS.SOURCE_TAG);
  const safe = {};
  if (patch.name !== undefined)  safe.name = normalizeName(patch.name);
  if (patch.color !== undefined) safe.color = patch.color || null;
  return tagRepo.update(tagId, safe);
}

function remove(currentUser, tagId) {
  const tag = tagRepo.findById(tagId);
  if (!tag) throw new NotFoundError('Tag not found.');
  projectService.requireCap(tag.project_id, currentUser, CAPS.SOURCE_TAG);
  return { ok: tagRepo.remove(tagId) };
}

// Ensure the tag and the source live in the same project, and the caller can
// tag in that project. Returns the resolved source row.
function requireSameProject(currentUser, sourceId, tag) {
  const src = sourceRepo.findById(sourceId);
  if (!src) throw new NotFoundError('Source not found.');
  projectService.requireCap(src.project_id, currentUser, CAPS.SOURCE_TAG);
  if (Number(src.project_id) !== Number(tag.project_id)) {
    throw new ForbiddenError('Tag and item belong to different projects.');
  }
  return src;
}

function assign(currentUser, sourceId, tagId) {
  const tag = tagRepo.findById(tagId);
  if (!tag) throw new NotFoundError('Tag not found.');
  requireSameProject(currentUser, sourceId, tag);
  tagRepo.assign(sourceId, tagId, currentUser.id);
  return tagRepo.tagsForSource(sourceId);
}

function unassign(currentUser, sourceId, tagId) {
  const tag = tagRepo.findById(tagId);
  if (!tag) throw new NotFoundError('Tag not found.');
  requireSameProject(currentUser, sourceId, tag);
  tagRepo.unassign(sourceId, tagId);
  return tagRepo.tagsForSource(sourceId);
}

module.exports = { list, create, update, remove, assign, unassign };
