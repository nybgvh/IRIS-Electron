/*
 * Red List assessment service. CRUD plus AI-drafted summaries: gather the
 * completed VoucherVision extractions for a scope and roll them up into the
 * six IUCN narrative sections via the configured aggregation provider.
 */

const assessmentRepo = require('../repositories/assessment-repo');
const itemRepo = require('../repositories/item-repo');
const projectService = require('./project-service');
const providerSelector = require('../aggregation/provider');
const { RedListPrompt, parseSections } = require('../aggregation/prompt');
const config = require('../config');
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

/*
 * Draft a Red List summary from a SELECTED set of items. Versioned + rerunnable:
 * a fresh generation starts a new series; passing `rerunOf` appends a new
 * version to that run's series so older runs stay visible. `opts`:
 *   sourceIds: array of item source_ids to summarize (required unless rerunOf,
 *              which defaults to the prior run's selection). The UI builds this
 *              from checkboxes; "select all" simply checks every item.
 *   rerunOf:   an existing assessment id to append a new version to.
 *   label:     display name (defaults to the shared taxon, else "Multiple taxa").
 *   model:     optional aggregation-model override.
 * Only 'complete' items are usable. Returns the created draft assessment
 * (payload.sections is the RETURN_SCHEMA object for the UI).
 */
async function generateSummary(currentUser, projectId, opts = {}) {
  projectService.requireCap(projectId, currentUser, CAPS.ASSESSMENT_EDIT);
  if (!config.hasAggregation()) {
    throw new ValidationError('Summary generation is not configured on this server.');
  }

  // Resolve versioning context from a rerun, if any.
  let seriesId = null;
  let prior = null;
  if (opts.rerunOf) {
    prior = assessmentRepo.findById(opts.rerunOf);
    if (!prior || Number(prior.project_id) !== Number(projectId)) {
      throw new NotFoundError('Assessment to rerun not found.');
    }
    seriesId = prior.series_id || prior.id;
  }

  // Selection: explicit source ids, or reuse the prior run's items on rerun.
  let sourceIds = (opts.sourceIds || []).map(Number).filter(Boolean);
  if (sourceIds.length === 0 && prior) {
    sourceIds = assessmentRepo.listSourceIds(prior.id);
  }
  if (sourceIds.length === 0) {
    throw new ValidationError('Select at least one item to summarize.');
  }

  // Pull the selected COMPLETE items (order-independent set membership).
  const wanted = new Set(sourceIds);
  const items = itemRepo
    .itemsForProject(projectId, { status: 'complete', limit: config.aggregation.maxRecords })
    .filter(it => wanted.has(Number(it.source_id)));
  if (items.length === 0) {
    throw new ValidationError('None of the selected items have completed processing yet.');
  }

  const prompt = new RedListPrompt(items).build();
  const provider = providerSelector.get();
  const { text, model } = await provider.summarize({ prompt, model: opts.model });
  const sections = parseSections(text); // RETURN_SCHEMA object

  const names = [...new Set(items.map(it => it.scientific_name).filter(Boolean))];
  const label = opts.label
    || (prior && prior.scientific_name)
    || (names.length === 1 ? names[0] : (names.length ? 'Multiple taxa' : 'Untitled summary'));
  const version = assessmentRepo.nextVersion(projectId, seriesId);

  const assessment = assessmentRepo.create({
    project_id: projectId,
    scientific_name: label,
    status: 'draft',
    series_id: seriesId,        // NULL on first run; set to own id just below
    version,
    generated_by_model: model,
    generated_at: new Date().toISOString(),
    payload_json: {
      sections,
      raw_text: text,
      record_count: items.length,
      taxa: names,
      source_ids: items.map(it => it.source_id),
      generated: true,
    },
    created_by: currentUser.id,
  });
  // First run in a series points its series_id at itself.
  if (!seriesId) assessmentRepo.setSeries(assessment.id, assessment.id);
  assessmentRepo.setSources(assessment.id, items.map(it => it.source_id));
  return assessmentRepo.findById(assessment.id);
}

module.exports = { list, get, create, update, remove, generateSummary };
