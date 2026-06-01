-- =============================================================================
-- 001_users.sql
--
-- The users table is the root of identity in IRIS. Every other table that
-- attributes an action (uploads, edits, ownership) references it.
--
-- Identity here is intentionally simple — email + password hash + display name
-- — so that the same schema works whether auth is local (Electron prototype)
-- or federated (SSO in the production web service). When SSO is added later,
-- add an `auth_providers` table that joins users(id) -> external identity.
-- Do NOT extend this table with provider-specific columns.
--
-- Roles are split across two tables on purpose:
--   - `role` here is the GLOBAL role. Only "admin" is escalated; admins can
--     do everything across all projects and manage other users. Everyone else
--     is "member" and gains rights through `project_members`.
--   - Per-project roles (owner/editor/uploader) live in `project_members`
--     (see migration 003).
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
    -- Surrogate primary key. We never expose this externally if we can help it
    -- (use email for display, opaque token for sessions).
    id              INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Login identity. Case-sensitivity is preserved by SQLite by default;
    -- the service layer lowercases before insert/lookup so "Foo@x" == "foo@x".
    email           TEXT NOT NULL UNIQUE,

    -- bcrypt hash (60 ASCII chars). Never stores plaintext. When migrating to
    -- a different hash algorithm later, add a `password_algo` column rather
    -- than overloading this field.
    password_hash   TEXT NOT NULL,

    -- Human-readable name shown in the user chip and on audit rows. Optional
    -- so initial sign-up can be email-only and the user can fill it later.
    display_name    TEXT,

    -- Global role. "admin" bypasses project membership checks; "member" must
    -- be added to a project via project_members to do anything project-scoped.
    -- CHECK constraint keeps invalid roles out of the DB even if a bug in the
    -- service layer tries to insert one.
    role            TEXT NOT NULL DEFAULT 'member'
                    CHECK (role IN ('admin', 'member')),

    -- ISO-8601 strings. SQLite stores these as TEXT; Postgres maps cleanly to
    -- TIMESTAMP WITH TIME ZONE. Using datetime('now') gives UTC by default.
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),

    -- Updated on successful login. Useful for "inactive user" cleanup in
    -- production. Nullable because new users haven't logged in yet.
    last_login_at   TEXT
);

-- Speeds up the only frequently-used lookup that isn't via id (login flow).
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
