# IRIS — Feature Status

Snapshot of what's implemented in this Electron prototype. Companion to
[`PLAN.md`](../PLAN.md) (the pre-code plan). Architecture is unchanged:
`src/server/` (framework-agnostic, no Electron imports) · `src/main/` (IPC
handlers mirroring future REST routes) · `src/renderer/` (talks only to
`api-client.js`).

Hard constraint held throughout: **no VoucherVisionGO / VoucherVision code is
modified** — those repos are read-only references for the API contract.

## Pipeline
- Upload image → VoucherVisionGO `/process` → store OCR + `formatted_json` +
  3 JPGs (original ≤20 MP, full, cropped). Queue runs at concurrency 16.
- Duplicate-upload prevention (SHA-256 of raw bytes; skip/force dialog).
- **PDF / field notebook**: rasterised to per-page JPGs in-app, then each page
  is submitted like a normal image — **OCR-only + skip-label-collage** (document
  pages have no single specimen label, which otherwise 500s the collage step).
  Missing `formatted_json` degrades gracefully in the UI.

## Library
- Rows (default) + gallery views; OCR + humanised `formatted_json` panels.
- Tags with a working create/apply dialog (Electron has no `window.prompt`).
- **Provenance auto-tags**: GBIF imports → `GBIF`; everything the user provides
  → `User Upload`. Type filters + dashboard counts key off upload origin, not
  stored file type (all pages are stored as images).
- Flag toggle; move; delete cascades derived artifacts + external refs.

## Geography
- Leaflet map, convex-hull EOO polygon (km²), WKT/GeoJSON/coords export.
- Per-point flag; **exclude-from-polygon** (tags a point `excluded polygon` and
  recomputes the hull/EOO from the remaining points).

## Assessment
- Master/detail: rail of assessments + reading pane; versioned, rerunnable runs.
- Builder scopes a run by **tag / type / all complete / hand-picked** items.
- Inline `#{tag}` specimen citations (hover card + lightbox); inline rename.
- OCR-only records feed the LLM their full OCR text.

## GBIF tab + References
- Embedded gbif.org (`<webview>`); metadata via the open JSON API.
- Images are downloaded **through the browser session** (institution hosts
  bot-block server fetches); attachment-served images are captured silently
  (no Save dialog); a per-image plain-Chrome UA fallback for hosts that reject
  the Electron UA. Non-image responses are rejected before saving.
- Single "Add to Library" + **bulk import** (16 workers, cap 500, random-subset
  option) with dedup before download. Saved-search bookmarks.
- gbif.org uses Catalogue-of-Life-XR taxon keys (alphanumeric) — the search
  URL is translated with the `checklistKey` so the API resolves them.
- **References tab**: imported occurrences as rows; split **Export** →
  `.txt` (one citation/line), `.ris` (reference managers), `.csv` (reference
  fields + the specimen's `formatted_json` flattened to columns).

## Shared UI
- Consistent tab header (gradient bar + mono label + serif name + meta) across
  Overview, Library, Geography, Assessment, GBIF, References.
- **Overview** dashboard: KPI strip + source-type / provenance / processing
  bars + Red List category chip.

## Data model
- SQLite migrations `008`–`016`: vv artifacts, tags, assessment provenance +
  versions, user settings, source flag + upload hash, `project_sources_gbif`,
  GBIF bookmarks.

## Verify
- Backend: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/smoke-pipeline.js`
- Renderer: `env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/smoke-renderer.js`
- Run: `env -u ELECTRON_RUN_AS_NODE npm start`
