-- =============================================================================
-- 009_tags.sql
--
-- Normalized, PROJECT-SCOPED tags for the Library. A tag belongs to exactly
-- one project so vocabularies stay per-project (two projects can both have a
-- "type specimen" tag without colliding), and so a tag facet is a cheap
-- indexed lookup rather than a scan over free-form metadata_json.
--
-- Why a join table (source_tags) rather than a JSON array on sources:
--   - faceting: "show every item tagged X" is an index seek, not a full scan.
--   - integrity: renaming/deleting a tag updates one row, not every item.
--   - it mirrors what the future Postgres web service will want.
--
-- Tags attach to SOURCES (the item's uploaded asset), which is the stable
-- identity a user tags — not the vouchervision_record (which can be re-run).
-- =============================================================================

CREATE TABLE IF NOT EXISTS tags (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,

    project_id  INTEGER NOT NULL
                REFERENCES projects(id) ON DELETE CASCADE,

    -- Display label. Uniqueness is per-project and case-sensitive at the DB
    -- level; the service layer normalizes/ trims before insert.
    name        TEXT NOT NULL,

    -- Optional UI color (hex like '#3b7a57'). NULL → renderer picks a default.
    color       TEXT,

    created_at  TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE (project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tags_project ON tags(project_id);

CREATE TABLE IF NOT EXISTS source_tags (
    source_id   INTEGER NOT NULL
                REFERENCES sources(id) ON DELETE CASCADE,

    tag_id      INTEGER NOT NULL
                REFERENCES tags(id) ON DELETE CASCADE,

    -- Who applied the tag. SET NULL so deleting a user keeps the tag on the
    -- item (provenance is nice-to-have, not load-bearing).
    added_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,

    added_at    TEXT NOT NULL DEFAULT (datetime('now')),

    PRIMARY KEY (source_id, tag_id)
);

-- Reverse lookup: "every item with tag X". (The forward lookup "every tag on
-- source Y" is served by the composite PK's leading column.)
CREATE INDEX IF NOT EXISTS idx_source_tags_tag ON source_tags(tag_id);
