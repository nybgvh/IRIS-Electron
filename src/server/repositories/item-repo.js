/*
 * Item read model.
 *
 * An "item" (the user's word) is the unified view a source presents in the
 * Library: the uploaded asset (sources) + its latest VoucherVision record
 * (status, ocr, formatted_json, derived image paths) + its tags. The
 * underlying tables stay normalized; this module assembles the read shape in
 * ONE round-trip so the renderer never N+1s.
 *
 * The future web service backs the same shape with a SQL view or a couple of
 * joined queries — the renderer contract does not change.
 */

const { getDb } = require('../db/connection');

// Whitelisted filters → SQL. Keeping this explicit avoids any string
// interpolation of caller input into the query.
function buildWhere({ type, status, tagId, search }) {
  const clauses = ['s.project_id = @projectId'];
  const params = {};
  if (type)   { clauses.push('s.source_type = @type');  params.type = type; }
  if (status) {
    // 'none' means uploaded-but-never-queued (no vv row yet).
    if (status === 'none') clauses.push('vv.id IS NULL');
    else { clauses.push('vv.status = @status'); params.status = status; }
  }
  if (tagId) {
    clauses.push('EXISTS (SELECT 1 FROM source_tags stf WHERE stf.source_id = s.id AND stf.tag_id = @tagId)');
    params.tagId = tagId;
  }
  if (search) {
    clauses.push(`(
      s.filename LIKE @q OR
      vv.scientific_name LIKE @q OR
      vv.ocr_text LIKE @q
    )`);
    params.q = `%${String(search).replace(/[%_]/g, '\\$&')}%`;
  }
  return { where: clauses.join(' AND '), params };
}

/*
 * Latest vv record per source, joined. SQLite has no DISTINCT ON, so we pick
 * the newest vv row per source with a correlated subquery on max(created_at)
 * (tie-broken by id). Sources with no vv row still appear (LEFT JOIN).
 */
function itemsForProject(projectId, opts = {}) {
  const { where, params } = buildWhere(opts);
  const limit = Number.isFinite(opts.limit) ? Math.max(1, Math.min(500, opts.limit)) : 200;
  const offset = Number.isFinite(opts.offset) ? Math.max(0, opts.offset) : 0;

  const rows = getDb().prepare(`
    SELECT
      s.id              AS source_id,
      s.project_id      AS project_id,
      s.uploaded_by     AS uploaded_by,
      s.source_type     AS source_type,
      s.filename        AS filename,
      s.storage_path    AS original_path,
      s.mime_type       AS mime_type,
      s.byte_size       AS byte_size,
      s.metadata_json   AS metadata_json,
      s.flagged         AS flagged,
      s.created_at      AS created_at,
      vv.id             AS vv_id,
      vv.status         AS vv_status,
      vv.scientific_name AS scientific_name,
      vv.ocr_text       AS ocr_text,
      vv.formatted_json AS formatted_json,
      vv.image_full_path    AS image_full_path,
      vv.image_cropped_path AS image_cropped_path,
      vv.error_message  AS error_message,
      vv.updated_at     AS vv_updated_at
    FROM sources s
    LEFT JOIN vouchervision_records vv
      ON vv.id = (
        SELECT v2.id FROM vouchervision_records v2
        WHERE v2.source_id = s.id
        ORDER BY v2.created_at DESC, v2.id DESC
        LIMIT 1
      )
    WHERE ${where}
    ORDER BY s.created_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ projectId, limit, offset, ...params });

  if (rows.length === 0) return [];

  // One extra query for all tags on the returned sources, grouped in JS.
  const ids = rows.map(r => r.source_id);
  const placeholders = ids.map(() => '?').join(',');
  const tagRows = getDb().prepare(`
    SELECT st.source_id AS source_id, t.id AS id, t.name AS name, t.color AS color
    FROM source_tags st
    JOIN tags t ON t.id = st.tag_id
    WHERE st.source_id IN (${placeholders})
    ORDER BY t.name COLLATE NOCASE ASC
  `).all(...ids);
  const tagsBySource = new Map();
  for (const t of tagRows) {
    if (!tagsBySource.has(t.source_id)) tagsBySource.set(t.source_id, []);
    tagsBySource.get(t.source_id).push({ id: t.id, name: t.name, color: t.color });
  }

  return rows.map(r => hydrateItem(r, tagsBySource.get(r.source_id) || []));
}

function hydrateItem(r, tags) {
  let metadata = {};
  if (r.metadata_json) { try { metadata = JSON.parse(r.metadata_json); } catch (_) {} }
  let formatted = null;
  if (r.formatted_json) { try { formatted = JSON.parse(r.formatted_json); } catch (_) {} }
  return {
    source_id: r.source_id,
    project_id: r.project_id,
    uploaded_by: r.uploaded_by,
    source_type: r.source_type,
    filename: r.filename,
    mime_type: r.mime_type,
    byte_size: r.byte_size,
    flagged: !!r.flagged,
    created_at: r.created_at,
    metadata,
    // Extraction — null until VVGO completes.
    vv_id: r.vv_id,
    vv_status: r.vv_status || (r.vv_id ? 'pending' : 'none'),
    scientific_name: r.scientific_name,
    ocr_text: r.ocr_text,
    formatted,
    has_full_image: !!r.image_full_path,
    has_cropped_image: !!r.image_cropped_path,
    error_message: r.error_message,
    vv_updated_at: r.vv_updated_at,
    tags,
  };
}

// Per-project counts for the dashboard: totals, VVGO status breakdown, and
// IUCN category distribution (from the denormalized formatted_json category).
function projectSummary(projectId) {
  const db = getDb();
  // Count by UPLOAD ORIGIN, not stored file type: PDF/notebook uploads are
  // exploded into per-page image rows stamped with metadata.origin, so every
  // row is now source_type 'image'. json_extract reads the origin back out;
  // rows with no origin (direct specimen uploads) count as specimens.
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS items,
      SUM(CASE WHEN COALESCE(json_extract(metadata_json, '$.origin'), 'specimen')
               NOT IN ('pdf', 'notebook') THEN 1 ELSE 0 END) AS images,
      SUM(CASE WHEN json_extract(metadata_json, '$.origin') = 'pdf'      THEN 1 ELSE 0 END) AS pdfs,
      SUM(CASE WHEN json_extract(metadata_json, '$.origin') = 'notebook' THEN 1 ELSE 0 END) AS notebooks
    FROM sources WHERE project_id = ?
  `).get(projectId);

  const vvRows = db.prepare(`
    SELECT status, COUNT(*) AS n
    FROM vouchervision_records WHERE project_id = ?
    GROUP BY status
  `).all(projectId);
  const vv = { pending: 0, complete: 0, errored: 0 };
  for (const r of vvRows) if (r.status in vv) vv[r.status] = r.n;

  const assessRows = db.prepare(`
    SELECT status, COUNT(*) AS n
    FROM assessments WHERE project_id = ?
    GROUP BY status
  `).all(projectId);
  const assessments = { draft: 0, review: 0, final: 0 };
  for (const r of assessRows) if (r.status in assessments) assessments[r.status] = r.n;

  // Provenance: GBIF imports (metadata.imported_from='gbif') vs everything the
  // user provided (direct images + PDF/notebook pages).
  const prov = db.prepare(`
    SELECT
      SUM(CASE WHEN json_extract(metadata_json, '$.imported_from') = 'gbif' THEN 1 ELSE 0 END) AS gbif,
      SUM(CASE WHEN COALESCE(json_extract(metadata_json, '$.imported_from'), '') <> 'gbif' THEN 1 ELSE 0 END) AS upload
    FROM sources WHERE project_id = ?
  `).get(projectId);
  const provenance = { gbif: prov.gbif || 0, upload: prov.upload || 0 };

  // Georeferenced: sources whose latest completed extraction carries valid
  // decimalLatitude/Longitude (matches the Geography tab's point criteria).
  const geo = db.prepare(`
    SELECT COUNT(*) AS n FROM sources s
    WHERE s.project_id = ? AND EXISTS (
      SELECT 1 FROM vouchervision_records vv
      WHERE vv.source_id = s.id AND vv.status = 'complete'
        AND json_extract(vv.formatted_json, '$.decimalLatitude')  NOT IN ('', '0', '0.0') AND json_extract(vv.formatted_json, '$.decimalLatitude')  IS NOT NULL
        AND json_extract(vv.formatted_json, '$.decimalLongitude') NOT IN ('', '0', '0.0') AND json_extract(vv.formatted_json, '$.decimalLongitude') IS NOT NULL
    )
  `).get(projectId);

  return { totals, vouchervision: vv, assessments, provenance, georeferenced: geo.n || 0 };
}

module.exports = { itemsForProject, projectSummary };
