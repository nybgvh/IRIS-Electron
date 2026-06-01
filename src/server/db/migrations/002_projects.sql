-- =============================================================================
-- 002_projects.sql
--
-- A project is the unit of collaboration in IRIS: a curated collection of
-- specimen sources, VoucherVision-derived JSON, and IUCN Red List
-- assessments produced from them. All data tables (sources, vouchervision,
-- assessments) live "inside" a project — there is no global data pool.
--
-- The owner is denormalized onto this row for two reasons:
--   1. Fast "list my projects" query without a join into project_members.
--   2. ON DELETE RESTRICT on owner_id means you cannot accidentally delete a
--      user that still owns projects — projects must be transferred first.
--
-- The same user is ALSO inserted into project_members with role='owner' at
-- create time, so authorization can use a single per-project lookup without
-- special-casing the owner column. (See project-service.js create flow.)
-- =============================================================================

CREATE TABLE IF NOT EXISTS projects (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Display name. Not required to be unique because two teams can both have
    -- a project called "Magnoliaceae" without conflict.
    name            TEXT NOT NULL,

    -- Free-form description shown on the Project tab.
    description     TEXT,

    -- The user who created the project. ON DELETE RESTRICT prevents orphaning
    -- projects when a user is deleted; the API must reassign ownership first.
    owner_id        INTEGER NOT NULL
                    REFERENCES users(id) ON DELETE RESTRICT,

    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),

    -- Soft-delete timestamp. Projects represent significant work, so we
    -- archive rather than hard-delete by default. NULL means active; a
    -- non-null value hides the project from default lists.
    archived_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
