-- =============================================================================
-- 006_assessments.sql
--
-- An IUCN Red List assessment for a taxon, drafted within a project. The
-- core deliverable of IRIS. Six narrative sections (taxonomy, geographic
-- range, habitat & ecology, use & trade, threats, conservation actions) live
-- inside the payload alongside category and criteria.
--
-- Two storage shapes are supported so the schema fits both small drafts and
-- large multi-section documents:
--   - `payload_json` — inline JSON, fine for in-progress drafts and small
--     records. Indexable later via SQLite JSON functions if needed.
--   - `storage_path` — path to a JSON/TXT file on disk, used when the
--     payload grows large enough that we'd rather not read it on every
--     list query. Exactly one of the two should be populated per row.
-- =============================================================================

CREATE TABLE IF NOT EXISTS assessments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,

    project_id      INTEGER NOT NULL
                    REFERENCES projects(id) ON DELETE CASCADE,

    -- Denormalized from the payload so the list view can sort/filter without
    -- parsing JSON. Kept in sync by the service layer.
    scientific_name TEXT,

    -- The IUCN category (e.g. 'CR', 'EN', 'VU'). Free-text rather than an
    -- enum so this row remains valid if IUCN ever revises the category set.
    iucn_category   TEXT,

    -- Criteria string like 'B1ab(iii)+2ab(iii)'. Free-text by intent.
    iucn_criteria   TEXT,

    -- Path on disk to the full JSON/TXT payload (relative to storage root).
    -- NULL when the payload lives inline in payload_json.
    storage_path    TEXT,

    -- Inline JSON payload. NULL when the payload lives in storage_path.
    payload_json    TEXT,

    -- Workflow state. 'draft' = being edited; 'review' = awaiting curator
    -- sign-off; 'final' = published assessment. Keeping the set small; richer
    -- workflow lives in a future audit/history table, not as more enum values.
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'review', 'final')),

    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assessments_project ON assessments(project_id);
CREATE INDEX IF NOT EXISTS idx_assessments_status  ON assessments(project_id, status);
