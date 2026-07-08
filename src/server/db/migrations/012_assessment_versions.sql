-- =============================================================================
-- 012_assessment_versions.sql
--
-- Versioned, rerunnable AI summaries. Each "generate" produces an assessment
-- row; rerunning appends a NEW version in the same SERIES rather than
-- overwriting, so older runs stay visible for comparison.
--
--   series_id — groups the versions of one summary together. The first run in
--               a series has series_id = its own id (set by the service right
--               after insert). Reruns copy the series_id and bump `version`.
--   version   — 1, 2, 3 … within a series (monotonic per series).
--
-- The six narrative sections (RETURN_SCHEMA keys) live in payload_json.sections;
-- generated_by_model / generated_at (010) carry provenance; assessment_sources
-- (010) records which items fed each run.
-- =============================================================================

ALTER TABLE assessments ADD COLUMN series_id INTEGER;
ALTER TABLE assessments ADD COLUMN version   INTEGER NOT NULL DEFAULT 1;

-- List a series' versions newest-first; group the Assessment tab by series.
CREATE INDEX IF NOT EXISTS idx_assessments_series
    ON assessments(project_id, series_id, version);
