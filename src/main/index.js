/*
 * Electron app bootstrap.
 *   1. Wait for `app` ready.
 *   2. Initialize DB connection + storage root using paths.js.
 *   3. Run migrations + seed.
 *   4. Register IPC handlers.
 *   5. Create the main window and hand it to the updater.
 *
 * This file is the ONLY place in the codebase that knows about the
 * relationship between Electron paths and the framework-agnostic server
 * layer. Replacing it (along with the IPC handlers) ports IRIS to a web
 * service without touching src/server or src/renderer.
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// -------------------------------------------------------------------------
// Dev-only .env loader. Reads <repo-root>/.env into process.env BEFORE any
// module that depends on config is required. Packaged builds never call
// dotenv — they take their environment from whatever shell launched them,
// same as a production web service. The shipped .app contains no .env
// (electron-builder excludes it explicitly in package.json `files`).
// -------------------------------------------------------------------------
if (!app.isPackaged) {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    console.log('[iris] loaded dev env from', envPath);
  }
}

const paths = require('./paths');
const { installMenu } = require('./menu');
const { createMainWindow } = require('./window');
const updater = require('./updater');
const ipc = require('./ipc');
const irisProtocol = require('./protocol');

const dbConn = require('../server/db/connection');
const { runMigrations } = require('../server/db/migrate');
const { runSeed } = require('../server/db/seed');
const fileStore = require('../server/storage/file-store');
const config = require('../server/config');

// Custom protocol schemes must be declared as privileged BEFORE app ready.
irisProtocol.registerSchemes();

function bootServer() {
  dbConn.init(paths.dbPath());
  const { applied } = runMigrations();
  if (applied.length) {
    console.log(`[iris] applied ${applied.length} migration(s):`, applied);
  }
  const seed = runSeed();
  if (seed.team)             console.log('[iris] seeded team:', 'NYBG Dev Team');
  if (seed.users && seed.users.length) console.log('[iris] seeded users:', seed.users);
  if (seed.project)          console.log('[iris] seeded default project');
  fileStore.init(paths.storageRoot());

  if (config.hasVouchervision()) {
    const vvQueue = require('../server/vouchervision/queue');
    const vvClient = require('../server/vouchervision/client');
    vvQueue.start();
    // Fire-and-forget — never block boot on a slow / unreachable VV server.
    vvClient.authCheck()
      .then(ok => console.log(`[iris] vouchervision auth-check: ${ok ? 'ok' : 'FAILED'}`))
      .catch(err => console.log('[iris] vouchervision auth-check error:', err && err.message));
    app.on('will-quit', () => { try { vvQueue.stop(); } catch (_) {} });
  } else {
    console.log('[iris] vouchervision queue: disabled (set VV_API_BASE_URL and VV_API_KEY to enable)');
  }
}

app.whenReady().then(() => {
  bootServer();
  installMenu();
  irisProtocol.register();
  ipc.registerAll();
  const win = createMainWindow();
  updater.init(win);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  const { BrowserWindow } = require('electron');
  if (BrowserWindow.getAllWindows().length === 0) {
    const win = createMainWindow();
    updater.init(win);
  }
});

app.on('will-quit', () => {
  try { dbConn.close(); } catch (_) {}
});
