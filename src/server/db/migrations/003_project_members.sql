-- =============================================================================
-- 003_project_members.sql
--
-- The authorization table. Answers the question "what can user U do on
-- project P?" with a single indexed lookup. Every project has at least one
-- row in this table — the owner. (Inserted automatically when the project is
-- created; see project-service.js.)
--
-- Project roles:
--   owner    — full control of the project, including deleting it and
--              managing members. Multiple owners are allowed.
--   editor   — edit assessments, upload/delete sources, run inference.
--              Cannot manage members or delete the project.
--   uploader — restricted role: upload sources only. Cannot edit metadata,
--              assessments, or run inference. Useful for field staff
--              contributing material to projects they don't curate.
--
-- The (project_id, user_id) UNIQUE constraint ensures one effective role per
-- user per project; promoting/demoting is an UPDATE, not a second row.
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_members (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,

    -- ON DELETE CASCADE: deleting a project cleans up its membership rows.
    project_id      INTEGER NOT NULL
                    REFERENCES projects(id) ON DELETE CASCADE,

    -- ON DELETE CASCADE: deleting a user removes their memberships. This is
    -- safe because the projects table uses RESTRICT, so a user that still
    -- owns any project cannot be deleted in the first place.
    user_id         INTEGER NOT NULL
                    REFERENCES users(id) ON DELETE CASCADE,

    -- Per-project role. Constrained at the DB level for safety.
    role            TEXT NOT NULL
                    CHECK (role IN ('owner', 'editor', 'uploader')),

    added_at        TEXT NOT NULL DEFAULT (datetime('now')),

    -- Audit: which user added this membership. Nullable so we can record
    -- system-created memberships (e.g. the owner row at project creation).
    -- ON DELETE SET NULL preserves history even if the actor is later removed.
    added_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,

    UNIQUE (project_id, user_id)
);

-- Two access patterns dominate:
--   "show me my projects" → index on user_id
--   "show me everyone on this project" → index on project_id (covered by UNIQUE).
CREATE INDEX IF NOT EXISTS idx_members_user ON project_members(user_id);
