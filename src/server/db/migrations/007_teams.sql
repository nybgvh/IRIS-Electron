-- =============================================================================
-- 007_teams.sql
--
-- Adds a "team" concept. A team is a group of users who can see each other
-- in the project member picker; the principal use is so a project owner can
-- pick collaborators from a dropdown of "people on my team" instead of
-- typing email addresses by hand.
--
-- Scope: team membership is a SOFT filter on the renderer (the picker only
-- shows teammates), but the backend does not enforce same-team for adding
-- project members — an admin can still pull a user from another team into a
-- project. That choice lives in src/server/services/project-service.js.
--
-- One team per user (users.team_id). If we ever need multi-team membership,
-- migrate to a join table; the migration is mechanical and won't require any
-- service-layer rewrites because the service surface (listMyTeammates) stays
-- the same.
-- =============================================================================

CREATE TABLE IF NOT EXISTS teams (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Display name. UNIQUE so admins can identify a team unambiguously from
    -- the Users tab in the Admin Tools dashboard.
    name        TEXT NOT NULL UNIQUE,
    -- Optional human description shown on the Teams tab.
    description TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ON DELETE SET NULL: deleting a team unassigns its members rather than
-- deleting them. Users without a team still log in fine; they just see
-- nobody in the project member picker until an admin reassigns them.
ALTER TABLE users ADD COLUMN team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;

-- The picker query is "WHERE team_id = ?", so a single-column index is the
-- right cover.
CREATE INDEX IF NOT EXISTS idx_users_team ON users(team_id);
