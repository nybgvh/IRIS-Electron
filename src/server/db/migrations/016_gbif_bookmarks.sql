-- =============================================================================
-- 016_gbif_bookmarks.sql
--
-- Saved GBIF searches. The GBIF tab lets a user bookmark the current gbif.org
-- search URL so they can jump back to a filtered view later (e.g. a taxon +
-- preserved-specimen gallery). Scoped per project — bookmarks track the sources
-- a project is drawing from.
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_gbif_bookmarks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    label       TEXT,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gbif_bm_project_url
    ON project_gbif_bookmarks(project_id, url);
CREATE INDEX IF NOT EXISTS idx_gbif_bm_project
    ON project_gbif_bookmarks(project_id);
