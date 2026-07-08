# IRIS — Implementation Plan

_Prototype Electron app → future public web service. This plan turns the
existing scaffold into the full loop: **upload an image → process with
VoucherVisionGO → store OCR + `formatted_json` + 3 JPGs → browse in a
Library with tags → roll many items up into draft IUCN Red List
assessments.**_

Written before code changes, per request. Ground truth for the decisions
below came from reading the current source and the VoucherVisionGO
API/client. **Hard constraint: this plan does NOT modify any
VoucherVisionGO or VoucherVision code** — those repos are read-only
references for the API contract only. New feature needs on the VVGO side
are deferred.

---

## 1. Locked decisions (from clarifying questions)

1. **Aggregation engine — Gemini now, swappable.** IRIS generates Red List
   summaries server-side via the Gemini API (the key already lives in
   `config.integrations.gemini.apiKey`), behind an `AggregationProvider`
   interface so it can be repointed at a future VVGO aggregate endpoint
   with zero UI/caller changes.
2. **Scope of this pass — core pipeline _and_ assessments together.**
3. **Original image — keep only the ≤20 MP JPG.** The upload is transcoded
   / downsampled to a ≤20 MP JPEG which becomes the canonical original; the
   raw bytes are not retained.
4. **Tags — normalized, project-scoped.** A `tags` table + `source_tags`
   join, giving a shared vocabulary and filterable facets across the
   Library (aligns with the OpenRefine-style faceting planned elsewhere).

---

## 2. The VoucherVisionGO contract IRIS depends on

Confirmed by reading `VoucherVisionGO/app.py` and the client. IRIS already
speaks this correctly in `src/server/vouchervision/client.js`; the changes
below are about what we do with the response.

- **Endpoint:** `POST {VV_API_BASE_URL}/process`, `multipart/form-data`
  with a `file` part plus form fields (`prompt`, `llm_model`, repeated
  `engines`, and boolean flags emitted as the literal string `'true'`).
- **Auth:** `X-API-Key: <key>` for an API key, or `Authorization: Bearer
  <token>` for a JWT (length + dot heuristic). Server-held; users never see it.
- **Response:** `/process` **always returns `application/json`**
  (`app.py:5124`) — the multipart path is not used here, so the existing
  client's JSON-only handling is correct. The JSON is an ordered dict with:
  - `ocr` — plain-text OCR (string).
  - `formatted_json` — the structured Darwin-Core-ish record (object; may
    arrive as a JSON string — handle both, like the Python client does).
  - `collage_info.base64image_input_resized` — **full-size** original as
    base64 JPEG (the "one full size" image).
  - `collage_info.base64image_text_collage` — **cropped** label collage as
    base64 JPEG (the "one cropped" image).
  - `collage_image_format: "jpeg"`, plus `ocr_info` / `parsing_info` /
    `impact` cost+token analytics we can keep for provenance.
  - Multi-page PDFs come back as `{ pages: [ {…per page…} ] }`.
- **Auth check:** `GET {base}/auth-check` (already used at boot).

**So the "3 JPGs" per specimen image are:** (1) the ≤20 MP original we make
locally, (2) `base64image_input_resized` decoded, (3)
`base64image_text_collage` decoded. And the two text artifacts to split out
are `ocr` and `formatted_json`.

---

## 3. Current state (what already works — do not rebuild)

The app is well past "barebones." Architecture is clean: `src/server`
(framework-agnostic, no electron imports) ↔ `src/main` (IPC handlers that
mirror future REST routes 1:1) ↔ `src/renderer` (talks only to
`api-client.js`, which wraps IPC today and `fetch()` later).

- **Auth / roles / capabilities** — bcrypt login, sessions, global
  `admin`/`member` + per-project `owner`/`editor`/`uploader`, capability
  matrix in `src/shared/capabilities.js`. Solid base for the web app.
- **Projects / members / teams** — full CRUD + membership + capability gating.
- **Upload → VVGO pipeline (structurally complete):**
  `sources:upload` → `source-service.upload()` saves bytes + dedups by
  sha256 → `maybeEnqueueVouchervision()` inserts a `pending`
  `vouchervision_records` row and wakes `vouchervision/queue.js`, which
  reads the file, `POST`s `/process` via `client.js`, and writes the whole
  response to `projects/<pid>/vouchervision/<id>.json`, then `setComplete`.
  PDF/notebook are rasterized page-by-page (`pdf-pages.js`) with bounded
  parallelism. Retries + error handling exist.
- **Storage** — `file-store.js` with a portable relative-path scheme and a
  path-traversal guard; `iris-source://source/<id>` custom protocol streams
  original bytes to `<img>`/`<embed>`.
- **Library UI (`pages/sources.js`)** — a real list + zoomable viewer,
  source-type filter chips, search, drag-and-drop upload, delete, per-item
  metadata JSON. Good bones for the gallery.
- **Migrations** — `001…007` (incl. `007_teams.sql`); `runMigrations()`
  auto-applies the next numbered file.

### Gaps this plan closes

1. The queue writes **one opaque JSON blob** — no split of `ocr` vs
   `formatted_json`, and **no JPGs are stored at all** (no full, no cropped,
   and the original isn't downsampled/transcoded).
2. **No queryable extraction** — the Library can't show or filter on
   extracted fields or processing status without parsing blobs.
3. **The renderer never surfaces VVGO results** — `api.vouchervision.*` is
   dead in the UI; the JSON viewer shows the null-filled `defaultMetadata`
   stub, not the extraction. No status badge.
4. **No tags** anywhere.
5. **No aggregate/summary generation** — assessments are row CRUD only; the
   notebook's Gemini rollup is unbuilt. Assessment/Geography/References
   pages are placeholders.
6. **Delete leaves orphans** — deleting a source/record doesn't clean up the
   on-disk VV JSON (and, once we add them, the derived JPGs).
7. **Settings don't persist** (in-memory `Map`).

---

## 4. Data model changes

New migrations (never edit an applied one — additive `ALTER`s only):

### `008_vv_artifacts.sql` — make extraction queryable + point at the JPGs
`ALTER TABLE vouchervision_records ADD COLUMN …`:
- `ocr_text TEXT` — the split-out OCR string.
- `formatted_json TEXT` — the structured record, stored inline as JSON text.
- `scientific_name TEXT` — denormalized from `formatted_json.scientificName`
  for cheap list/sort/search + assessment grouping.
- `image_full_path TEXT` — relative path to the decoded full-size JPG.
- `image_cropped_path TEXT` — relative path to the decoded cropped JPG.
- `error_message TEXT` — replaces the "stash the error in the JSON blob"
  workaround with a real column.
- New index `idx_vv_scientific` on `(project_id, scientific_name)`.
- (`source_id` is already indexed via `idx_vv_source`.)

The `storage_path` column keeps pointing at the full raw response JSON
(provenance + `ocr_info`/`parsing_info`/cost). The `sources.storage_path`
is the ≤20 MP original JPG — that's JPG #1; the two columns above are #2/#3.

### `009_tags.sql` — normalized project tags
- `tags (id, project_id → projects ON DELETE CASCADE, name, color,
  created_at)`, `UNIQUE(project_id, name)`, index on `project_id`.
- `source_tags (source_id → sources ON DELETE CASCADE, tag_id → tags ON
  DELETE CASCADE, added_by → users SET NULL, added_at)`, PK
  `(source_id, tag_id)`, index on `tag_id`.

### `010_assessment_provenance.sql` — link summaries to their inputs
- `assessment_sources (assessment_id → assessments ON DELETE CASCADE,
  source_id → sources ON DELETE SET NULL)`, PK `(assessment_id, source_id)`
  — records which items fed a generated summary.
- `ALTER TABLE assessments ADD COLUMN generated_by_model TEXT`,
  `ADD COLUMN generated_at TEXT` — provenance for AI-drafted assessments.
  (The six narrative sections continue to live in `payload_json`.)

### `011_user_settings.sql` — persist settings (kills the in-memory stub)
- `user_settings (user_id → users ON DELETE CASCADE, key, value,
  updated_at)`, PK `(user_id, key)`.

### The unified **"item"** shape
An _item_ (the user's word) = a `sources` row + its latest
`vouchervision_records` row (status, ocr, formatted_json, 3 image paths) +
its tags. A new `itemsForProject(projectId, {type, tag, status, search,
limit, offset})` query JOINs these and aggregates tags so the Library
renders in one round-trip (no N+1). Tables stay normalized; "item" is the
read model.

---

## 5. Core pipeline changes (upload → 3 JPGs + split text)

### 5.1 New dependency: `sharp`
For downsampling/transcoding and re-encoding base64 → JPEG. Native module →
`postinstall` already runs `electron-builder install-app-deps`; note the
x64/arm64 native-rebuild concern for cross-platform `deploy.sh` builds
(tracked in memory `project_x64_builds`). HEIC/TIFF inputs rely on libvips
codecs — verify coverage; fall back to "store as-is if decode fails."

### 5.2 `src/server/storage/image.js` (new)
- `downsampleToJpeg(buffer, { maxMP = 20, quality = 85 })` — auto-orient via
  EXIF, scale so `width*height ≤ 20,000,000`, output JPEG. Returns
  `{ buffer, width, height }`.
- `base64ToJpeg(b64)` — decode; pass through `sharp(...).jpeg()` to
  guarantee a valid JPG on disk.

### 5.3 `file-store.js` additions
- `saveVouchervisionImage(projectId, vvId, kind, buffer)` →
  `projects/<pid>/vouchervision/<vvId>-<kind>.jpg` (`kind` ∈ `full` |
  `cropped`; per-page `p<NN>-<kind>` for PDFs).
- `deleteVouchervisionArtifacts(projectId, vvId)` — remove `<id>.json` and
  all `<id>-*.jpg` (used by delete + reprocess).

### 5.4 `source-service.upload()` — downsample on the way in
When `source_type === 'image'` (or `mime` is `image/*`): run
`downsampleToJpeg` before `saveSource`, store the JPEG bytes, set
`mime_type: 'image/jpeg'`, and record pixel dims in `metadata_json`. PDFs /
notebooks are stored unchanged (they're documents). Dedup hash is computed
on the stored (downsampled) bytes.

### 5.5 `queue.js` — persist the split artifacts
After `client.submit` returns the dict, for a single image:
- Parse `formatted_json` (accept object or JSON string).
- Decode `collage_info.base64image_input_resized` → save as `full`.
- Decode `collage_info.base64image_text_collage` → save as `cropped`.
- Still write the full response JSON to `<id>.json` (provenance).
- `vvRepo.setComplete(id, { storage_path, ocr_text, formatted_json,
  scientific_name, image_full_path, image_cropped_path })`.

For PDF/notebook: keep the `{ pages: [...] }` blob; populate the columns
from the first successful page and save each page's JPGs as `p<NN>-*`. (One
`vouchervision_records` row per multi-page source stays; per-page-as-item is
noted as a future refinement, not this pass.)

### 5.6 Serve the derived JPGs
Extend the custom protocol: `iris-source://vv/<vvId>/full` and
`…/cropped` (and `…/original` aliasing the source). Web equivalent later:
`GET /api/vouchervision/:id/image/:kind`.

### 5.7 Repo + delete correctness
- `vouchervision-repo`: add `findBySource(sourceId)`, extend
  `setComplete/setErrored` to write the new columns, and make
  `listForProject`/items support status filtering + paging.
- Deleting a source or a VV record now also calls
  `deleteVouchervisionArtifacts` (fixes the orphaned-file gap).

---

## 6. Tags

- `src/server/repositories/tag-repo.js` + `services/tag-service.js`:
  `listForProject`, `create`, `rename`, `delete`, `assign(sourceId,tagId)`,
  `unassign(sourceId,tagId)`, `tagsForSources([...ids])`.
- Capability: add `SOURCE_TAG = 'source:tag'` to the matrix, granted to
  `owner` + `editor`. (Uploaders view/upload only; tagging their own uploads
  is a possible follow-up, flagged not built.)
- IPC (mirrors REST): `tags:list|create|update|delete|assign|unassign`.

---

## 7. Library / gallery UI

Rebuild `pages/sources.js` into the **Library** (rename the tab label;
keep the route id stable to avoid churn) around the unified item read model.

- **Grid + list toggle.** Grid = thumbnail cards (use the `cropped` JPG as
  the thumb, fall back to original); list keeps today's dense view.
- **Per-item status badge** — `pending` / `processing` / `complete` /
  `errored`, polled/refreshed from `vouchervision:getForSource`. Errored
  shows the `error_message`.
- **Facets** — existing source-type chips + a **tag facet** (multi-select)
  + status filter + search across filename/`scientific_name`/OCR.
- **Item detail** — an image switcher across the 3 JPGs (original / full /
  cropped), the OCR text panel, and a pretty `formatted_json` view; tag
  editor (add/remove); delete; **move-to-project** (see §9); "Reprocess".
- **Bulk actions** — multi-select → bulk tag / bulk delete / bulk reprocess.
- **api-client.js** — add `tags.*`, `vouchervision.getForSource`,
  `vouchervision.reprocess`, `sources.move`, `assessments.generate`, and
  wire real `settings.*`.

---

## 8. Assessments + aggregation (the notebook, productized)

### 8.1 Swappable provider
`src/server/aggregation/` :
- `provider.js` — `summarize({ records, promptTemplate, model }) →
  { text, sections, model }`. Chooses the implementation from
  `config.aggregation.provider` (default `gemini`).
- `gemini-provider.js` — web-native `fetch` to
  `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent?key=…`
  with the notebook's exact prompt over `[{scientificName, country, …,
  ocr_text}]` gathered from completed records. No Python.
- `vvgo-provider.js` — **not built**, documented stub so a future VVGO
  aggregate endpoint drops in without touching callers.
- Config: `AGGREGATION_PROVIDER` (default `gemini`), `AGGREGATION_MODEL`
  (default `gemini-3.1-pro-preview`, matching the notebook). Per-item
  extraction stays on the cheaper flash-lite default; aggregation uses pro.

### 8.2 `assessment-service.generateSummary(user, projectId, opts)`
Gate on `ASSESSMENT_EDIT`. Gather completed `vouchervision_records` for the
scope (all / by tag / by selected item ids / by `scientific_name`), pull
`formatted_json` + `ocr_text`, build the six-section IUCN prompt (Taxonomy,
Geographic Range, Habitat, Ecology, Use & Trade, Threats & Conservation),
call the provider, persist an `assessments` row (`payload_json` = sections,
`generated_by_model`, `generated_at`) + `assessment_sources` links. Returns
the draft for editing.

### 8.3 Assessment tab UI (`pages/assessment.js`)
List assessments (name, IUCN category badge, status). "Generate summary"
flow: pick scope (all / tag / selection), confirm model, run, then show the
editable six-section draft with category/criteria/status
(`draft`/`review`/`final`) and the input-item count. Manual create/edit
stays available.

### 8.4 Project dashboard
Add a summary panel to the Project tab: item count, VVGO completion
(complete/pending/errored), IUCN category distribution, assessments by
status. (Reuses the item read model; not the admin-only global stats.)

Geography/References remain placeholders this pass (Geography is a natural
next step: plot `decimalLatitude`/`decimalLongitude` from `formatted_json`).

---

## 9. Cross-cutting: "change their projects" (move item)
`sources:move(sourceId, targetProjectId)` — require `SOURCE_DELETE` on the
source's project and `SOURCE_UPLOAD` on the target. Re-key `project_id` on
the source + its `vouchervision_records`, and physically move the files
(storage paths embed `project_id`). Tags are project-scoped, so moving drops
tags that don't exist in the target (documented). Add `file-store.moveItem`.

---

## 10. Web-app readiness & security posture (keep, don't regress)
- **Keys never reach the client.** `VV_API_KEY`, `GEMINI_API_KEY`, etc. are
  read only in `src/server` (via `config.js`) — the renderer holds none.
  This is already true and must stay true; the Gemini provider runs
  server-side only.
- **IPC ↔ REST parity.** Every new channel maps to one future route
  (documented inline), so the `api-client.js` swap to `fetch()` stays a
  drop-in.
- **Capabilities** extended (`source:tag`) rather than bypassed; the UI
  gates on the same matrix the services enforce.
- **Flagged before public launch (not blocking this pass):** replace the
  dev seed (hardcoded `1234`) with a real first-admin flow; add session
  TTL/persistence; consider SSO. Noted, not built now.

---

## 11. New IPC surface (all mirror REST routes)
`vouchervision:getForSource`, `vouchervision:reprocess`;
`tags:list|create|update|delete|assign|unassign`;
`sources:move`; `assessments:generate`; real persistent `settings:get|update`.

## 12. Migrations added
`008_vv_artifacts.sql`, `009_tags.sql`, `010_assessment_provenance.sql`,
`011_user_settings.sql`.

## 13. New/changed files (map)
- **New:** `src/server/storage/image.js`, `src/server/aggregation/{provider,
  gemini-provider,vvgo-provider}.js`, `src/server/repositories/tag-repo.js`,
  `src/server/services/tag-service.js`,
  `src/server/repositories/user-settings-repo.js`, migrations `008–011`,
  `src/main/ipc/tags.ipc.js`.
- **Changed:** `config.js` (aggregation block), `file-store.js`,
  `source-service.js`, `vouchervision/queue.js`,
  `vouchervision-repo.js`, `vouchervision-service.js`,
  `assessment-service.js`, `assessment-repo.js`, `settings.ipc.js` (→ real
  service), `src/main/protocol.js`, `src/main/ipc/{sources,vouchervision,
  assessments,index}.ipc.js`, `preload.js`, `renderer/js/api-client.js`,
  `renderer/js/pages/{sources,assessment,project}.js`, relevant CSS,
  `package.json` (`sharp`).

---

## 14. Sequencing (dependency order; each step independently verifiable)

1. **Data layer** — migrations `008–011`; repo methods (`findBySource`,
   tag-repo, user-settings-repo, item read model, assessment provenance).
2. **Image + storage** — add `sharp`; `image.js`; `file-store` image/move/
   cleanup helpers.
3. **Pipeline** — downsample on upload; `queue.js` splits + stores the 3
   JPGs and columns; delete cascades artifacts; protocol serves derived JPGs.
   _Verify: upload a specimen JPG against a real `VV_API_BASE_URL`/`VV_API_KEY`,
   confirm 3 JPGs on disk + populated columns + `iris-source://vv/...` serves._
4. **Tags** — repo/service/IPC + capability.
5. **Library UI** — grid/list, status badge, tag + status facets, 3-image
   detail + OCR + formatted_json, tag editor, reprocess, bulk actions, move.
6. **Aggregation** — provider interface + Gemini provider + config.
7. **Assessments** — `generateSummary` + assessment tab UI + project
   dashboard. _Verify: generate a summary from several completed items._
8. **Settings persistence** + final pass: run/extend smoke tests
   (`scripts/smoke-*.js`) to cover upload→process→artifacts and tag CRUD.

Env needed to exercise the live pipeline (dev `.env`, gitignored):
`VV_API_BASE_URL=https://vouchervision-go-738307415303.us-central1.run.app`,
`VV_API_KEY=…`, `GEMINI_API_KEY=…`.

## 14b. Update — summaries are versioned + schema-driven (post-plan change)

After the plan was written you supplied `examples/prompt.py` (a `RedListPrompt`
class with a `RETURN_SCHEMA` JSON contract) and asked for versioned, rerunnable
summaries on **selected** items. Implemented accordingly:

- **`prompt.py` → `src/server/aggregation/prompt.js`.** IRIS runs on Node (you
  asked for no Python), so the class was ported 1:1 — same `RETURN_SCHEMA`,
  `RECORD_FIELDS`, and section text. **Edit `prompt.js`** to tune the prompt;
  it reads IRIS's stored items (`formatted` + `ocr_text`) instead of `*.json`
  files. `examples/prompt.py` stays as your reference.
- **JSON output.** The model is asked to return the `RETURN_SCHEMA` object
  (`{Taxonomy, Geographic_Range, Habitat, Ecology, Use_and_Trade,
  Threats_and_Conservation_Actions}`); the Gemini provider sets
  `responseMimeType: application/json`; `parseSections()` maps it to the six UI
  sections (with fenced-JSON + permissive fallbacks).
- **Selected items only.** `assessments:generate` takes `{ sourceIds }` — the
  Library checkboxes build the set ("Summarize N →"); the Assessment tab also
  offers "Summarize all complete items".
- **Versioned + rerunnable.** `012_assessment_versions.sql` adds `series_id` +
  `version`. A fresh generate starts a series (`series_id = own id, version 1`);
  `{ rerunOf }` appends `version+1` in the same series, reusing the prior
  selection. Older versions are retained; the Assessment tab groups by series
  with a version picker. `assessment_sources` records each run's inputs.

## 15. Risks / notes
- **`sharp` native builds** across arm64/x64 for `deploy.sh` (see
  `project_x64_builds`); HEIC/TIFF codec coverage — degrade gracefully.
- **PDF derived images** are per-page; this pass stores them but models one
  record per source (per-page-as-item deferred).
- **`formatted_json` may be a string or object** — normalize on ingest.
- **Reprocessing** overwrites artifacts; guard against deleting a source
  mid-flight (record re-read already exists in the queue).
