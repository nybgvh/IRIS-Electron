/*
 * Item service — the read side of the Library. An "item" is a source joined
 * with its latest VoucherVision extraction and its tags (see item-repo). All
 * gated on PROJECT_VIEW; the write paths (upload, tag, delete, reprocess) live
 * in their own services.
 */

const itemRepo = require('../repositories/item-repo');
const projectService = require('./project-service');
const { CAPS } = require('../../shared/capabilities');

function list(currentUser, projectId, opts = {}) {
  projectService.requireCap(projectId, currentUser, CAPS.PROJECT_VIEW);
  return itemRepo.itemsForProject(projectId, {
    type: opts.type || null,
    status: opts.status || null,
    tagId: opts.tagId || null,
    search: opts.search || null,
    limit: opts.limit,
    offset: opts.offset,
  });
}

function summary(currentUser, projectId) {
  projectService.requireCap(projectId, currentUser, CAPS.PROJECT_VIEW);
  return itemRepo.projectSummary(projectId);
}

module.exports = { list, summary };
