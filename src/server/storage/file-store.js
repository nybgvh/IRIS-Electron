/*
 * File storage. Writes bytes under a host-resolved root with a stable
 * relative path scheme so the DB rows are portable across hosts (local
 * disk in Electron, S3/object storage in production).
 *
 * Layout:
 *   <root>/projects/<project_id>/sources/<sha>-<safe_filename>
 *   <root>/projects/<project_id>/vouchervision/<id>.json
 *   <root>/projects/<project_id>/assessments/<id>.json
 *
 * The relative path returned by `saveSource` is what gets stored in
 * sources.storage_path. The absolute path is recovered with `resolve()` —
 * never construct paths by hand from the DB row.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let storageRoot = null;

function init(root) {
  storageRoot = root;
  fs.mkdirSync(root, { recursive: true });
}

function getRoot() {
  if (!storageRoot) throw new Error('Storage not initialized.');
  return storageRoot;
}

function resolve(relPath) {
  const abs = path.resolve(getRoot(), relPath);
  // Defensive: make sure the resolved path is still inside the root.
  if (!abs.startsWith(path.resolve(getRoot()) + path.sep) &&
      abs !== path.resolve(getRoot())) {
    throw new Error('Path escapes storage root.');
  }
  return abs;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function safeName(filename) {
  return String(filename).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

function projectDir(projectId, sub) {
  const rel = path.join('projects', String(projectId), sub);
  fs.mkdirSync(path.join(getRoot(), rel), { recursive: true });
  return rel;
}

function saveSource(projectId, filename, buffer, { unique = false } = {}) {
  const sub = projectDir(projectId, 'sources');
  const hash = sha256(buffer);
  // Content-addressed by default (identical bytes → one file). `unique` is used
  // for a forced re-upload of an existing file so the new row owns its own file
  // and deleting one copy never removes the other's bytes.
  const prefix = unique
    ? `${hash.slice(0, 8)}-${crypto.randomBytes(4).toString('hex')}`
    : hash.slice(0, 12);
  const rel = path.join(sub, `${prefix}-${safeName(filename)}`);
  const abs = path.resolve(getRoot(), rel);
  fs.writeFileSync(abs, buffer);
  return { storage_path: rel, sha256: hash, byte_size: buffer.length };
}

function deleteFile(relPath) {
  try {
    fs.unlinkSync(resolve(relPath));
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

function saveVouchervisionJson(projectId, vvId, jsonString) {
  const sub = projectDir(projectId, 'vouchervision');
  const rel = path.join(sub, `${vvId}.json`);
  const abs = path.resolve(getRoot(), rel);
  fs.writeFileSync(abs, jsonString);
  return rel;
}

/*
 * Save a derived VoucherVision image (a JPEG buffer) next to its record JSON.
 *   kind: 'full' | 'cropped'  (plus 'p<NN>-full' etc. for PDF pages)
 * Layout: <root>/projects/<pid>/vouchervision/<vvId>-<kind>.jpg
 */
function saveVouchervisionImage(projectId, vvId, kind, buffer) {
  const sub = projectDir(projectId, 'vouchervision');
  const rel = path.join(sub, `${vvId}-${safeName(kind)}.jpg`);
  const abs = path.resolve(getRoot(), rel);
  fs.writeFileSync(abs, buffer);
  return rel;
}

/*
 * Remove every on-disk artifact for a VoucherVision record: the <id>.json and
 * all <id>-*.jpg derived images. Best-effort — missing files are fine. Used by
 * delete (no more orphans) and by reprocess (clear stale artifacts first).
 */
function deleteVouchervisionArtifacts(projectId, vvId) {
  const dirRel = path.join('projects', String(projectId), 'vouchervision');
  const dirAbs = path.resolve(getRoot(), dirRel);
  let removed = 0;
  let names;
  try { names = fs.readdirSync(dirAbs); } catch (_) { return 0; }
  const prefix = `${vvId}`;
  for (const name of names) {
    // Match "<id>.json", "<id>-full.jpg", "<id>-p0001-cropped.jpg" — but NOT
    // "<id2>..." where id2 starts with id (guard with a boundary char).
    if (name === `${prefix}.json` ||
        name.startsWith(`${prefix}-`)) {
      try { fs.unlinkSync(path.join(dirAbs, name)); removed++; } catch (_) {}
    }
  }
  return removed;
}

/*
 * Move all of a VoucherVision record's artifacts (the <id>.json and every
 * <id>-*.jpg) from one project's vouchervision dir to another's. Returns the
 * new relative paths for the columns the DB tracks:
 *   { storage_path, image_full_path, image_cropped_path }
 * (page images <id>-pNNNN-*.jpg are moved too but only referenced inside the
 * JSON blob, so they aren't returned). Missing files are simply skipped.
 */
function moveVouchervisionArtifacts(oldProjectId, newProjectId, vvId) {
  const oldDirAbs = path.resolve(getRoot(), 'projects', String(oldProjectId), 'vouchervision');
  const newDirRel = projectDir(newProjectId, 'vouchervision');
  const newDirAbs = path.resolve(getRoot(), newDirRel);
  const out = { storage_path: null, image_full_path: null, image_cropped_path: null };
  let names;
  try { names = fs.readdirSync(oldDirAbs); } catch (_) { return out; }

  for (const name of names) {
    if (name !== `${vvId}.json` && !name.startsWith(`${vvId}-`)) continue;
    const newRel = path.join(newDirRel, name);
    moveInPlace(path.join(oldDirAbs, name), path.resolve(newDirAbs, name));
    if (name === `${vvId}.json`) out.storage_path = newRel;
    else if (name === `${vvId}-full.jpg`) out.image_full_path = newRel;
    else if (name === `${vvId}-cropped.jpg`) out.image_cropped_path = newRel;
  }
  return out;
}

// rename with a cross-device (EXDEV) copy+unlink fallback; ENOENT-safe.
function moveInPlace(oldAbs, newAbs) {
  if (oldAbs === newAbs) return;
  try {
    fs.renameSync(oldAbs, newAbs);
  } catch (err) {
    if (err.code === 'EXDEV') {
      fs.copyFileSync(oldAbs, newAbs);
      try { fs.unlinkSync(oldAbs); } catch (_) {}
    } else if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

/*
 * Move a source's stored bytes from one project's tree to another (item move).
 * Returns the new relative storage_path. The DB re-key happens in the service;
 * this only moves the file. No-op-safe if the source file is already gone.
 */
function moveSource(oldRelPath, newProjectId, filename) {
  const sub = projectDir(newProjectId, 'sources');
  const base = path.basename(oldRelPath) || safeName(filename);
  const newRel = path.join(sub, base);
  const oldAbs = resolve(oldRelPath);
  const newAbs = path.resolve(getRoot(), newRel);
  if (oldAbs === newAbs) return oldRelPath;
  moveInPlace(oldAbs, newAbs);
  return newRel;
}

module.exports = {
  init,
  getRoot,
  resolve,
  sha256,
  saveSource,
  saveVouchervisionJson,
  saveVouchervisionImage,
  deleteVouchervisionArtifacts,
  moveVouchervisionArtifacts,
  moveSource,
  deleteFile,
  projectDir,
};
