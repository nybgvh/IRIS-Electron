-- =============================================================================
-- 013_source_flag.sql
--
-- A per-item "flag" — a shared, project-visible marker a curator toggles to
-- call attention to a specimen. Surfaced everywhere an individual specimen is
-- shown (Library card/drawer) and on the Geography map, where a flagged point
-- draws orange instead of the default green.
--
-- Stored as 0/1 (SQLite has no bool). Belongs to the SOURCE (the stable item
-- identity), like tags.
-- =============================================================================

ALTER TABLE sources ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0;
