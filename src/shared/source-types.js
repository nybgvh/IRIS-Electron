/*
 * Source-type vocabulary — kept distinct from MIME type because the *intent*
 * of an upload matters more than its content type for filtering and routing.
 *
 *   image    — herbarium specimen photographs (JPEG/PNG/TIFF/HEIC)
 *   pdf      — published papers, monographs, manuals
 *   notebook — field notebooks. Stored as PDF but treated as its own category
 *              in the UI (separate filter chip, distinct icon).
 */

const SOURCE_TYPES = Object.freeze({
  IMAGE: 'image',
  PDF: 'pdf',
  NOTEBOOK: 'notebook',
});

const SOURCE_TYPE_LIST = Object.freeze([
  SOURCE_TYPES.IMAGE,
  SOURCE_TYPES.PDF,
  SOURCE_TYPES.NOTEBOOK,
]);

module.exports = { SOURCE_TYPES, SOURCE_TYPE_LIST };
