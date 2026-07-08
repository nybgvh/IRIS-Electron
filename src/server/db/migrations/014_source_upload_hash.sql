-- =============================================================================
-- 014_source_upload_hash.sql
--
-- Duplicate-upload detection. `sources.sha256` holds the hash of the STORED
-- bytes (post-downsample for images), which the client can't reproduce. To let
-- the client detect "I've already uploaded this exact file" before transferring
-- it, we also record the hash of the ORIGINAL uploaded bytes.
--
--   upload_sha256 — SHA-256 of the raw uploaded file, computed identically on
--   the client (Web Crypto) and server (crypto). The dedup key within a project.
--
-- A forced re-upload ("upload anyway") still writes a new row; the column just
-- powers the pre-upload check + the default silent dedup.
-- =============================================================================

ALTER TABLE sources ADD COLUMN upload_sha256 TEXT;

CREATE INDEX IF NOT EXISTS idx_sources_project_uploadsha
    ON sources(project_id, upload_sha256);
