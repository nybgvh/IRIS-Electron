/*
 * Custom protocol `iris-source://` — streams uploaded source bytes to the
 * renderer so `<img src>` and `<embed>` work natively without base64-ing
 * megabytes through IPC.
 *
 * URL shapes:
 *   iris-source://source/<id>          — the uploaded original (≤20 MP JPG)
 *   iris-source://vv/<vvId>/full       — VVGO full-size derived JPG
 *   iris-source://vv/<vvId>/cropped    — VVGO cropped label collage JPG
 *
 * Layered design: this file knows only about HTTP responses + the storage
 * root. It calls into the framework-agnostic source repo + file-store to
 * actually resolve and read bytes. When porting to web, this whole file
 * is deleted and the same resource lives at `GET /api/sources/:id/raw`.
 *
 * IMPORTANT: registerSchemes() MUST be called BEFORE app is ready (i.e.
 * before `app.whenReady()` resolves). The handler is wired in `register()`
 * after app ready.
 */

const fs = require('fs');
const { protocol, net } = require('electron');
const { pathToFileURL } = require('url');

const sourceRepo = require('../server/repositories/source-repo');
const vvRepo = require('../server/repositories/vouchervision-repo');
const fileStore = require('../server/storage/file-store');

const SCHEME = 'iris-source';

function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
      },
    },
  ]);
}

// Stream a file on disk back as an inline Response with the given content-type.
async function streamFile(absPath, { contentType, filename } = {}) {
  if (!absPath || !fs.existsSync(absPath)) return new Response('File missing', { status: 410 });
  const res = await net.fetch(pathToFileURL(absPath).toString());
  const headers = new Headers(res.headers);
  if (contentType) headers.set('Content-Type', contentType);
  if (filename) headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
  return new Response(res.body, { status: 200, headers });
}

function register() {
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      // Resource type is the hostname: 'source' or 'vv'.
      const kind = url.hostname;
      const parts = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);

      if (kind === 'vv') {
        // iris-source://vv/<vvId>/<full|cropped>
        const vvId = parseInt(parts[0], 10);
        const which = parts[1];
        if (!vvId || (which !== 'full' && which !== 'cropped')) {
          return new Response('Bad derived-image request', { status: 400 });
        }
        const rec = vvRepo.findById(vvId);
        if (!rec) return new Response('Not Found', { status: 404 });
        const rel = which === 'full' ? rec.image_full_path : rec.image_cropped_path;
        if (!rel) return new Response('No such image', { status: 404 });
        return streamFile(fileStore.resolve(rel), {
          contentType: 'image/jpeg',
          filename: `${vvId}-${which}.jpg`,
        });
      }

      // Default / 'source': iris-source://source/<id>
      const id = parseInt(parts[0], 10);
      if (!id) return new Response('Bad source id', { status: 400 });
      const row = sourceRepo.findById(id);
      if (!row) return new Response('Not Found', { status: 404 });
      // Override Content-Type with what we recorded at upload time — file://
      // can guess wrong for arbitrary filenames.
      return streamFile(fileStore.resolve(row.storage_path), {
        contentType: row.mime_type,
        filename: row.filename,
      });
    } catch (err) {
      console.error('[iris-source] handler failed:', err);
      return new Response('Internal error', { status: 500 });
    }
  });
}

module.exports = { SCHEME, registerSchemes, register };
