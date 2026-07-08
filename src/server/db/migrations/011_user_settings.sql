-- =============================================================================
-- 011_user_settings.sql
--
-- Durable per-user preferences. Replaces the in-memory Map in
-- settings.ipc.js (which lost everything on restart). A simple key/value bag
-- keyed by user — schema-on-read values (JSON-encoded strings) so adding a
-- new preference is a renderer change, not a migration.
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_settings (
    user_id     INTEGER NOT NULL
                REFERENCES users(id) ON DELETE CASCADE,

    key         TEXT NOT NULL,

    -- Opaque value; the renderer decides the encoding (usually JSON).
    value       TEXT,

    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),

    PRIMARY KEY (user_id, key)
);
