-- =============================================================================
-- 015_project_sources_gbif.sql
--
-- External web-source imports: GBIF occurrences.
--
-- This is the first of a planned family of `project_sources_*` tables — one per
-- external source IRIS can pull specimens from (GBIF now; natural-heritage
-- libraries, BHL, etc. later). Each keeps its source-specific columns rather
-- than cramming everything into one polymorphic table.
--
-- One row = one GBIF occurrence imported into a project. The occurrence's image
-- is downloaded and saved as an ordinary Library item (sources row); `source_id`
-- links back to it. If that image is later deleted the citation/provenance here
-- survives (ON DELETE SET NULL) so a publication reference is never lost.
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_sources_gbif (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,

    project_id      INTEGER NOT NULL
                    REFERENCES projects(id) ON DELETE CASCADE,

    -- The Library image created from this occurrence (NULL if it was deleted).
    source_id       INTEGER
                    REFERENCES sources(id) ON DELETE SET NULL,

    -- The GBIF occurrence key — the number shown as "GBIF ID" on gbif.org.
    -- Unique per project (idx below) so re-importing the same record dedups.
    gbif_id         TEXT NOT NULL,

    occurrence_url  TEXT,          -- https://gbif.org/occurrence/{gbif_id}
    image_url       TEXT,          -- the media `identifier` URL we downloaded
    citation        TEXT,          -- full "please cite" string (dataset + occ URL)

    scientific_name TEXT,
    dataset_key     TEXT,
    dataset_title   TEXT,
    dataset_doi     TEXT,
    publisher       TEXT,
    catalog_number  TEXT,
    country         TEXT,
    latitude        REAL,
    longitude       REAL,

    -- Full GBIF occurrence JSON as fetched, for provenance / future fields.
    raw_json        TEXT,

    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gbif_project_gbifid
    ON project_sources_gbif(project_id, gbif_id);
CREATE INDEX IF NOT EXISTS idx_gbif_project
    ON project_sources_gbif(project_id);
CREATE INDEX IF NOT EXISTS idx_gbif_source
    ON project_sources_gbif(source_id);
