/*
 * Updater IPC handlers. These don't require auth — they're Electron-host
 * controls, not data operations — so they bypass the standard envelope
 * wrapper and call ipcMain.handle directly.
 *
 * In a web port, these handlers simply don't exist; the renderer's
 * api-client returns a stub. (See renderer/js/api-client.js for the
 * platform check.)
 */

const { ipcMain } = require('electron');
const updater = require('../updater');

module.exports = () => {
  ipcMain.handle('updater:info',     () => ({ ok: true, data: updater.info() }));
  ipcMain.handle('updater:check',    async () => ({ ok: true, data: await updater.checkForUpdate() }));
  ipcMain.handle('updater:download', async () => ({ ok: true, data: await updater.downloadUpdate() }));
  ipcMain.handle('updater:install',  () => ({ ok: true, data: updater.installUpdate() }));
};
