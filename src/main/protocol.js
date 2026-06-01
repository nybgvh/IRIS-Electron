/*
 * Custom protocol `iris-source://` — streams uploaded source bytes to the
 * renderer so `<img src>` and `<embed>` work natively without base64-ing
 * megabytes through IPC.
 *
 * URL shape:    iris-source://source/<id>
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

function register() {
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      // iris-source://source/<id>  →  hostname='source', pathname='/<id>'
      const parts = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
      const id = parseInt(parts[0], 10);
      if (!id) return new Response('Bad source id', { status: 400 });

      const row = sourceRepo.findById(id);
      if (!row) return new Response('Not Found', { status: 404 });

      const abs = fileStore.resolve(row.storage_path);
      if (!fs.existsSync(abs)) return new Response('File missing', { status: 410 });

      // net.fetch(file://…) gives us a streamed Response with the right body.
      const res = await net.fetch(pathToFileURL(abs).toString());
      const headers = new Headers(res.headers);
      // Override Content-Type with what we recorded at upload time — file://
      // can guess wrong for arbitrary filenames.
      if (row.mime_type) headers.set('Content-Type', row.mime_type);
      headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(row.filename)}"`);
      return new Response(res.body, { status: 200, headers });
    } catch (err) {
      console.error('[iris-source] handler failed:', err);
      return new Response('Internal error', { status: 500 });
    }
  });
}

module.exports = { SCHEME, registerSchemes, register };
