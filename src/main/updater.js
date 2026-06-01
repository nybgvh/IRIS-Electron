/*
 * electron-updater wrapper. Mirrors the VoucherVisionGO-Editor pattern:
 * autoDownload is disabled so the user (or our Settings UI) controls when
 * the download happens; events are forwarded to the renderer on the
 * `updater:status` channel.
 *
 * In dev (when `app.isPackaged === false`), all the IPC handlers no-op so
 * we don't spam the network checking for updates of an unpackaged app.
 */

const { app } = require('electron');

// electron-updater's `autoUpdater` getter touches `app.getVersion()` at
// module-load time. Requiring it lazily — only after app is ready — avoids
// crashing in dev/unpackaged contexts.
let _autoUpdater = null;
function getAutoUpdater() {
  if (!_autoUpdater) _autoUpdater = require('electron-updater').autoUpdater;
  return _autoUpdater;
}

let mainWindow = null;
let wired = false;

function send(event, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', { event, ...payload });
  }
}

function wireEvents() {
  if (wired) return;
  wired = true;
  const au = getAutoUpdater();
  au.autoDownload = false;
  au.autoInstallOnAppQuit = true;
  au.on('checking-for-update', () => send('checking', {}));
  au.on('update-available',     info => send('available', { version: info.version }));
  au.on('update-not-available', info => send('up-to-date', { version: info.version }));
  au.on('download-progress',    p    => send('downloading', { percent: p.percent }));
  au.on('update-downloaded',    info => send('downloaded', { version: info.version }));
  au.on('error',                err  => send('error', { message: String(err && err.message || err) }));
}

function init(window) {
  mainWindow = window;
  if (!app.isPackaged) return;
  wireEvents();
  setTimeout(() => {
    try { getAutoUpdater().checkForUpdates(); } catch (_) { /* network etc. */ }
  }, 5000);
}

async function checkForUpdate() {
  if (!app.isPackaged) return { ok: true, dev: true };
  wireEvents();
  await getAutoUpdater().checkForUpdates();
  return { ok: true };
}

async function downloadUpdate() {
  if (!app.isPackaged) return { ok: true, dev: true };
  await getAutoUpdater().downloadUpdate();
  return { ok: true };
}

function installUpdate() {
  if (!app.isPackaged) return { ok: true, dev: true };
  setImmediate(() => getAutoUpdater().quitAndInstall());
  return { ok: true };
}

function info() {
  return {
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
  };
}

module.exports = { init, checkForUpdate, downloadUpdate, installUpdate, info };
