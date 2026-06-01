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

function saveSource(projectId, filename, buffer) {
  const sub = projectDir(projectId, 'sources');
  const hash = sha256(buffer);
  const rel = path.join(sub, `${hash.slice(0, 12)}-${safeName(filename)}`);
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

module.exports = {
  init,
  getRoot,
  resolve,
  saveSource,
  saveVouchervisionJson,
  deleteFile,
  projectDir,
};
