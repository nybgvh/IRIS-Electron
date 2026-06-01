/*
 * Resolves filesystem locations that the server layer needs (database file,
 * storage root) using Electron's userData directory. This is the ONLY file
 * in main/ that the server layer indirectly depends on — when porting to
 * web, replace it with a module that reads env vars (DB_URL, STORAGE_ROOT).
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const config = require('../server/config');

function userDataDir() {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function dbPath() {
  // config.db.url is for the future Postgres world; for SQLite the value can
  // be an absolute file path. Empty → default under userData.
  if (config.db.url) return config.db.url;
  return path.join(userDataDir(), 'iris.sqlite');
}

function storageRoot() {
  // Honour the IRIS_STORAGE_ROOT override (set via .env in dev) so uploads
  // can be put on a NAS / shared Dropbox / external drive during testing.
  const root = config.storage.root || path.join(userDataDir(), 'storage');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

module.exports = { userDataDir, dbPath, storageRoot };
