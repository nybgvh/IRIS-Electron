const gbifService = require('../../server/services/gbif-service');
const gbifCapture = require('../gbif-capture');

module.exports = (register) => {
  // Toggle silent capture of forced-download images (Electron/main concern, not
  // a server service) — the renderer turns it on around import operations.
  register('gbif:setCapture', (_user, on) => { gbifCapture.setCapturing(!!on); return { ok: true }; });
  // Preview an occurrence (metadata + the image URL the renderer downloads).
  register('gbif:getOccurrence', (user, projectId, ref) => gbifService.getOccurrence(user, projectId, ref));
  // Commit an import with the image bytes the renderer captured via the webview.
  register('gbif:saveImport',    (user, projectId, ref, imageData) => gbifService.saveImport(user, projectId, ref, imageData));
  register('gbif:list',          (user, projectId) => gbifService.list(user, projectId));
  register('gbif:remove',        (user, id) => gbifService.remove(user, id));
  // Enumerate every imaged occurrence in a search (for bulk import).
  register('gbif:enumerateSearch', (user, projectId, searchUrl, opts) => gbifService.enumerateSearch(user, projectId, searchUrl, opts || {}));
  // Saved GBIF searches (bookmarks).
  register('gbif:bookmark',        (user, projectId, url, label) => gbifService.bookmarkSearch(user, projectId, url, label));
  register('gbif:bookmarks',       (user, projectId) => gbifService.listBookmarks(user, projectId));
  register('gbif:removeBookmark',  (user, id) => gbifService.removeBookmark(user, id));
};
