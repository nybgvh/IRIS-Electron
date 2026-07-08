-- =============================================================================
-- 008_vv_artifacts.sql
--
-- Makes the VoucherVisionGO extraction QUERYABLE and points at the derived
-- images the pipeline now stores.
--
-- Until now the queue wrote the ENTIRE /process response as one opaque JSON
-- blob at `storage_path`, so the Library could neither show extracted fields
-- nor filter on them without parsing every file. It also stored no images.
--
-- VoucherVisionGO's /process JSON carries (see PLAN.md §2):
--   - `ocr`                                   → ocr_text
--   - `formatted_json`                        → formatted_json (queryable)
--   - `formatted_json.scientificName`         → scientific_name (denormalized)
--   - `collage_info.base64image_input_resized`→ decoded to a JPG (full)
--   - `collage_info.base64image_text_collage` → decoded to a JPG (cropped)
--
-- `storage_path` KEEPS pointing at the full raw response JSON for provenance
-- (cost/token analytics live there). The two image_* columns hold JPGs #2/#3;
-- JPG #1 is the ≤20 MP original at sources.storage_path.
--
-- error_message replaces the old "stash the error inside the JSON blob"
-- workaround (queue.finalizeError) with a real column.
-- =============================================================================

ALTER TABLE vouchervision_records ADD COLUMN ocr_text          TEXT;
ALTER TABLE vouchervision_records ADD COLUMN formatted_json     TEXT;
ALTER TABLE vouchervision_records ADD COLUMN scientific_name    TEXT;
ALTER TABLE vouchervision_records ADD COLUMN image_full_path    TEXT;
ALTER TABLE vouchervision_records ADD COLUMN image_cropped_path TEXT;
ALTER TABLE vouchervision_records ADD COLUMN error_message      TEXT;

-- Group/sort/search by taxon (Library facets + assessment roll-ups).
CREATE INDEX IF NOT EXISTS idx_vv_scientific
    ON vouchervision_records(project_id, scientific_name);
