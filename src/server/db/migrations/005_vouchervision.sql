-- =============================================================================
-- 005_vouchervision.sql
--
-- VoucherVision is an OCR + extraction pipeline that turns a herbarium
-- specimen image into structured JSON (taxonomy, locality, collector, date,
-- etc). This table tracks one row per JSON record produced — typically one
-- per source image, but a record may outlive its source (the file can be
-- deleted and the record kept for the data it captured).
--
-- The actual JSON lives on disk at `storage_path` (same convention as
-- sources). For Phase 0 we don't store the JSON inline; if a future feature
-- needs in-DB queries over the fields, add a generated columns layer.
-- =============================================================================

CREATE TABLE IF NOT EXISTS vouchervision_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,

    project_id      INTEGER NOT NULL
                    REFERENCES projects(id) ON DELETE CASCADE,

    -- The image (or PDF) this record was derived from. NULL is allowed
    -- because a source can be deleted while the extracted data is kept.
    source_id       INTEGER REFERENCES sources(id) ON DELETE SET NULL,

    -- Relative path to the JSON file in storage. See sources.storage_path.
    storage_path    TEXT NOT NULL,

    -- Pipeline state. 'pending' = queued/running; 'complete' = JSON written;
    -- 'errored' = pipeline failed and storage_path may point at a stub or
    -- error log. Keeping the enum small avoids bloat — add more states only
    -- if a real workflow needs them.
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'complete', 'errored')),

    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vv_project ON vouchervision_records(project_id);
CREATE INDEX IF NOT EXISTS idx_vv_source  ON vouchervision_records(source_id);
