-- =============================================================================
-- 010_assessment_provenance.sql
--
-- Records WHICH items fed an AI-drafted Red List assessment, and with which
-- model, so a generated summary is auditable and reproducible.
--
-- An assessment is a roll-up over many vouchervision_records (their
-- formatted_json + ocr). We link to the SOURCES that fed it (the stable item
-- identity) rather than the vouchervision_records (which can be re-run and
-- replaced). The six narrative sections continue to live in
-- assessments.payload_json — only provenance is added here.
-- =============================================================================

CREATE TABLE IF NOT EXISTS assessment_sources (
    assessment_id INTEGER NOT NULL
                  REFERENCES assessments(id) ON DELETE CASCADE,

    -- SET NULL kept for symmetry with the rest of the schema, but the row is
    -- only meaningful with a source; the service filters NULLs out on read.
    source_id     INTEGER
                  REFERENCES sources(id) ON DELETE SET NULL,

    PRIMARY KEY (assessment_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_assessment_sources_source
    ON assessment_sources(source_id);

-- Provenance for AI-drafted assessments. NULL for manually-authored rows.
ALTER TABLE assessments ADD COLUMN generated_by_model TEXT;
ALTER TABLE assessments ADD COLUMN generated_at       TEXT;
