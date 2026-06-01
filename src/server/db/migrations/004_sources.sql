-- =============================================================================
-- 004_sources.sql
--
-- A "source" is any uploaded asset that grounds an assessment: a herbarium
-- specimen image, a published PDF, or a field notebook (PDF treated as a
-- distinct category in the UX). One row per file.
--
-- Storage policy:
--   - The bytes live ON DISK, not in the database. SQLite can store blobs
--     but doing so makes backups, dedup, and migration to S3 painful.
--   - `storage_path` is RELATIVE to a storage root that the host resolves
--     (Electron: `<userData>/projects/<project_id>/sources/`; web: an env
--     var or S3 prefix). This makes the rows portable across hosts.
--   - sha256 is computed at upload time. It enables dedup ("this file is
--     already uploaded to this project") and tamper detection.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sources (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,

    project_id      INTEGER NOT NULL
                    REFERENCES projects(id) ON DELETE CASCADE,

    -- Who uploaded the file. ON DELETE SET NULL so deleting a user doesn't
    -- destroy the source — the file and its provenance survive.
    uploaded_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,

    -- See shared/source-types.js. 'notebook' is PDF-encoded but distinct in
    -- the UI; keeping the type explicit avoids guessing from filenames.
    source_type     TEXT NOT NULL
                    CHECK (source_type IN ('image', 'pdf', 'notebook')),

    -- The original filename as supplied by the uploader (display only — do
    -- NOT use this as a filesystem path; use storage_path).
    filename        TEXT NOT NULL,

    -- Path relative to the host's storage root. The host is responsible for
    -- resolving + sandboxing this to prevent path traversal.
    storage_path    TEXT NOT NULL,

    -- Best-effort MIME detection at upload time. Useful for serving the file
    -- back to the renderer with the right Content-Type.
    mime_type       TEXT,

    -- Size in bytes. Cheap server-side stat at upload time; cached here for
    -- quick listing without touching the filesystem.
    byte_size       INTEGER,

    -- SHA-256 hex digest of the file bytes. Enables dedup and integrity
    -- checks. Indexed for fast "is this file already in this project?" queries.
    sha256          TEXT,

    -- Free-form JSON for OCR output, EXIF, georeferencing, or anything else
    -- a future feature wants to attach. Schema-on-read.
    metadata_json   TEXT,

    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sources_project       ON sources(project_id);
CREATE INDEX IF NOT EXISTS idx_sources_project_sha   ON sources(project_id, sha256);
CREATE INDEX IF NOT EXISTS idx_sources_type          ON sources(project_id, source_type);
