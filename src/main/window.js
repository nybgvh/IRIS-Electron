const path = require('path');
const { BrowserWindow, shell } = require('electron');

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'IRIS',
    backgroundColor: '#f7f6f1',
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // The GBIF tab embeds gbif.org in a <webview> (an out-of-process guest,
      // unlike an <iframe> which GBIF's X-Frame-Options would block). The guest
      // runs with its own isolation and no preload — see src/renderer/js/pages/gbif.js.
      webviewTag: true,
    },
  });
  win.maximize();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Silently capture forced-download GBIF images (Content-Disposition:
  // attachment) during imports so they don't pop a Save dialog — see
  // src/main/gbif-capture.js.
  require('./gbif-capture').setup(win);

  // Route all external http(s) links to the system browser. The renderer is
  // a trusted local page — we never want it to navigate away from itself.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  return win;
}

module.exports = { createMainWindow };
