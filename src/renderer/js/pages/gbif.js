/*
 * GBIF tab.
 *
 * Embeds the live gbif.org site in an Electron <webview> (an out-of-process
 * browser guest — unlike an <iframe>, which GBIF's X-Frame-Options blocks). The
 * user browses/searches specimens exactly as on gbif.org.
 *
 * Importing an image is the hard part. GBIF occurrence images are hosted by the
 * PUBLISHING INSTITUTION (e.g. ngpherbaria.org), not GBIF, and those hosts
 * bot-block server-side fetches. So we download the image the way a human would:
 * inside a hidden <webview> that shares the browse session (cookies + Cloudflare
 * clearance), we navigate straight to the image URL and read its bytes with a
 * same-origin fetch — then hand them to the main process to save. The only thing
 * the backend fetches is GBIF's open JSON API (metadata + citation).
 *
 * Flow when the user clicks "Add to {Project} Library":
 *   1. read the occurrence id from the browse webview's URL
 *   2. api.gbif.getOccurrence(id)  → image URL + citation + metadata (+ dup check)
 *   3. download the image in a hidden webview (browser session)
 *   4. api.gbif.saveImport(id, bytes) → Library item + a GBIF reference row
 */

(function () {
  const HOME = 'https://www.gbif.org/occurrence/search?occurrenceStatus=present&view=GALLERY&basisOfRecord=PRESERVED_SPECIMEN&mediaType=StillImage';
  const BULK_CONCURRENCY = 16; // parallel image-download workers (matches VVGO)

  // Same-origin fetch run INSIDE the hidden webview once it has navigated to the
  // image URL — returns a data: URL of the original bytes (from cache, no re-hit).
  const FETCH_SNIPPET = `(async () => {
    const r = await fetch(location.href, { credentials: 'include' });
    if (!r.ok) throw new Error('http ' + r.status);
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    // A blocked host serves an HTML "rejected" page instead of the image — bail.
    if (ct.startsWith('text/') || ct.includes('html') || ct.includes('json')) throw new Error('not-an-image:' + ct);
    const b = await r.blob();
    return await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error || new Error('read failed'));
      fr.readAsDataURL(b);
    });
  })()`;

  const state = {
    container: null, projectId: null, view: null, busy: false,
    currentId: null, onSearch: false, bookmarks: [], menuOpen: false,
    bulk: { running: false, cancel: false },
  };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Plain-Chrome UA (default Electron UA with the Electron/IRIS tokens stripped),
  // used ONLY as a per-image fallback when a host rejects the Electron UA (e.g.
  // Smithsonian ids.si.edu returns an HTML "Request Rejected" to "Electron").
  const CLEAN_UA = navigator.userAgent.replace(/\s*(?:Electron|IRIS)\/\S+/gi, '').replace(/\s{2,}/g, ' ').trim();

  // Images served with Content-Disposition: attachment become browser DOWNLOADS
  // (not inline renders). The main process captures those silently and pushes
  // the bytes here, keyed by URL, where the waiting downloadViaWebview resolves.
  const pendingDownloads = new Map(); // imageUrl → resolve(dataUrl | null)
  let downloadListenerReady = false;
  function ensureDownloadListener() {
    if (downloadListenerReady) return;
    downloadListenerReady = true;
    window.IRIS.api.gbif.onDownload((data) => {
      let key = pendingDownloads.has(data.url) ? data.url
        : (Array.isArray(data.chain) ? data.chain.find(u => pendingDownloads.has(u)) : null);
      if (!key) return; // not one of ours (or already handled)
      const resolve = pendingDownloads.get(key);
      pendingDownloads.delete(key);
      resolve(data.ok && data.dataBase64 ? `data:image/jpeg;base64,${data.dataBase64}` : null);
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[c]));
  }

  function parseId(url) {
    if (!url) return null;
    let m = String(url).match(/occurrence\/(\d+)/);
    if (m) return m[1];
    m = String(url).match(/[?&]entity=o_(\d+)/);
    if (m) return m[1];
    return null;
  }

  function setStatus(msg) {
    const el = state.container && state.container.querySelector('#gbif-status');
    if (el) el.textContent = msg || '';
  }

  function updateActionButtons() {
    const c = state.container;
    if (!c) return;
    const proj = window.IRIS.session.getCurrentProject();
    const pname = proj ? proj.name : 'Library';
    const busy = state.busy || state.bulk.running;

    const add = c.querySelector('#gbif-add');
    if (add) {
      const onSpecimen = !!state.currentId;
      // Only actionable on a specimen occurrence page — disabled elsewhere.
      add.disabled = busy || !onSpecimen;
      add.textContent = onSpecimen ? `＋ Add GBIF ${state.currentId} to ${pname}` : '＋ Add to Library';
      add.title = onSpecimen ? '' : 'Open a specimen occurrence first — click an image on GBIF.';
      add.classList.toggle('ready', onSpecimen && !busy);
    }
    const all = c.querySelector('#gbif-import');
    if (all) {
      all.disabled = busy || !state.onSearch;
      all.title = state.onSearch
        ? 'Import images from this search (all up to 500, or a random subset)'
        : 'Open a GBIF search (gallery) first.';
    }
  }

  function onNav(url) {
    const u = url || (state.view && state.view.getURL()) || '';
    state.currentId = parseId(u);
    state.onSearch = /\/occurrence\/search/.test(u) || /\/occurrence\/gallery/.test(u);
    const bar = state.container && state.container.querySelector('#gbif-url');
    if (bar && document.activeElement !== bar) bar.value = u;
    updateActionButtons();
  }

  // Download an image THROUGH THE BROWSER: a hidden webview (shared session)
  // navigates to the image URL, then a same-origin fetch reads the bytes.
  function downloadViaWebview(imageUrl, opts = {}) {
    return new Promise((resolve, reject) => {
      const fw = document.createElement('webview');
      fw.setAttribute('partition', 'persist:gbif'); // share cookies/clearance with the browse view
      if (opts.userAgent) fw.setAttribute('useragent', opts.userAgent); // per-webview UA override
      fw.className = 'gbif-fetch-view';
      let settled = false;
      const finish = (fn, arg) => {
        if (settled) return; settled = true;
        clearTimeout(timer);
        pendingDownloads.delete(imageUrl);
        try { fw.remove(); } catch (_) {}
        fn(arg);
      };
      const timer = setTimeout(() => finish(reject, new Error('Timed out downloading the image.')), 60000);

      // Attachment case: navigation becomes a download; main captures the bytes
      // and the global listener resolves this pending entry.
      pendingDownloads.set(imageUrl, (dataUrl) => {
        if (dataUrl) finish(resolve, dataUrl);
        else finish(reject, new Error('The image could not be downloaded.'));
      });

      // Inline case: the image renders → same-origin fetch reads the bytes.
      // A rejection/HTML page also fires did-finish-load; the snippet throws on
      // a non-image content-type, so we fail fast instead of waiting to time out.
      // (An attachment download does NOT fire did-finish-load — handled above.)
      fw.addEventListener('did-finish-load', async () => {
        try {
          const dataUrl = await fw.executeJavaScript(FETCH_SNIPPET, true);
          finish(resolve, dataUrl);
        } catch (e) {
          finish(reject, new Error('Could not read a valid image (' + (e && e.message || e) + ').'));
        }
      });
      fw.addEventListener('did-fail-load', (e) => {
        // errorCode -3 (ERR_ABORTED) == navigation turned into a download; wait
        // for the capture event. Other main-frame errors are real failures.
        if (e.isMainFrame && e.errorCode !== -3) {
          finish(reject, new Error('The image failed to load in the browser (code ' + e.errorCode + ').'));
        }
      });
      document.body.appendChild(fw);
      fw.src = imageUrl;
    });
  }

  // Download an image, presenting the DEFAULT (Electron) UA first. Only if that
  // fails (e.g. a host that 403s the "Electron" UA) do we retry the same image
  // once as plain Chrome. Keeps the honest UA as default, spoofs only on demand.
  async function fetchImageBytes(imageUrl) {
    try {
      return await downloadViaWebview(imageUrl);
    } catch (_) {
      if (!CLEAN_UA || CLEAN_UA === navigator.userAgent) throw _;
      return await downloadViaWebview(imageUrl, { userAgent: CLEAN_UA });
    }
  }

  async function addToLibrary() {
    if (state.busy) return;
    const view = state.view;
    const id = parseId(view && view.getURL());
    if (!id) {
      window.IRIS.toast('Open a specimen occurrence on GBIF (click an image), then Add.', 'error');
      return;
    }
    state.busy = true; updateActionButtons();
    try {
      setStatus(`Looking up GBIF ${id}…`);
      const meta = await window.IRIS.api.gbif.getOccurrence(state.projectId, id);
      if (meta.duplicate) {
        window.IRIS.toast(`GBIF ${id} is already in this project.`);
        return;
      }
      if (!meta.has_image || !meta.image_url) {
        window.IRIS.toast('This GBIF occurrence has no downloadable image.', 'error');
        return;
      }
      setStatus('Downloading image via the browser…');
      await window.IRIS.api.gbif.setCapture(true); // catch attachment-style images silently
      let dataUrl;
      try { dataUrl = await fetchImageBytes(meta.image_url); }
      finally { window.IRIS.api.gbif.setCapture(false); }
      setStatus('Saving to the Library…');
      const row = await window.IRIS.api.gbif.saveImport(state.projectId, id, dataUrl);
      const name = row.scientific_name || meta.scientific_name || 'specimen';
      const proj = window.IRIS.session.getCurrentProject();
      window.IRIS.toast(`Added GBIF ${id} — ${name} — to ${proj ? proj.name : 'the project'}.`);
    } catch (err) {
      window.IRIS.toast(err.message || 'Import failed.', 'error');
    } finally {
      state.busy = false;
      setStatus('');
      updateActionButtons();
    }
  }

  // --- bulk import: download images from the current search ----------------
  // Randomly pick n items (Fisher–Yates partial shuffle).
  function sample(arr, n) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, Math.max(0, Math.min(n, a.length)));
  }

  async function importFromSearch() {
    if (state.busy || state.bulk.running) return;
    const url = state.view && state.view.getURL();
    if (!/\/occurrence\/(search|gallery)/.test(url || '')) {
      window.IRIS.toast('Open a GBIF search (gallery) first.', 'error');
      return;
    }
    state.busy = true; updateActionButtons(); setStatus('Enumerating search results…');
    let res;
    try {
      res = await window.IRIS.api.gbif.enumerateSearch(state.projectId, url);
    } catch (err) {
      window.IRIS.toast(err.message || 'Could not read the search.', 'error');
      return;
    } finally {
      state.busy = false; setStatus(''); updateActionButtons();
    }

    const occ = res.occurrences || [];
    if (!occ.length) { window.IRIS.toast('No images found for this search.', 'error'); return; }
    const pending = occ.filter(o => !o.already_imported);
    const alreadyIds = occ.filter(o => o.already_imported).map(o => o.gbif_id);

    const choice = await promptImport({
      total: res.total, found: occ.length, pending: pending.length,
      already: alreadyIds.length, alreadyIds, capped: res.capped,
    });
    if (!choice) return;
    const items = choice.mode === 'subset' ? sample(pending, choice.n) : pending;
    if (!items.length) { window.IRIS.toast('Nothing new to import.'); return; }
    runBulk(items);
  }

  // Import options modal: always-visible advisory + counts + a random-subset
  // picker (default 20). Resolves to {mode:'all'|'subset', n} or null.
  function promptImport(info) {
    return new Promise((resolve) => {
      let rootEl = document.getElementById('modal-root');
      if (!rootEl) { rootEl = document.createElement('div'); rootEl.id = 'modal-root'; document.body.appendChild(rootEl); }
      const maxN = Math.max(1, info.pending);
      const defN = Math.min(20, maxN);
      const noPending = info.pending === 0;
      const already = info.already ? ` <span class="muted">(${info.already} already imported)</span>` : '';
      const capNote = info.capped
        ? `<p class="muted small">Your search matches ${Number(info.total).toLocaleString()} imaged records — capped at the first ${info.found}. Narrow the search to reach the rest.</p>`
        : '';
      // Dedup happens before any download: list the GBIF IDs already in the
      // project and note they'll be skipped.
      const dupIds = info.alreadyIds || [];
      const dupBlock = dupIds.length ? `
        <div class="gbif-dups">
          <div class="gbif-dups-head">${dupIds.length} already in this project — these will be skipped (not re-downloaded):</div>
          <div class="gbif-dups-ids">${dupIds.map(id => `<span class="dup-id">${esc(id)}</span>`).join('')}</div>
        </div>` : '';
      const onKey = (e) => { if (e.key === 'Escape') done(null); };
      const done = (v) => { document.removeEventListener('keydown', onKey); rootEl.innerHTML = ''; resolve(v); };

      rootEl.innerHTML = `
        <div class="modal-backdrop" data-backdrop>
          <div class="modal-card" role="dialog" aria-modal="true">
            <div class="modal-title">Import from GBIF search</div>
            <div class="modal-body">
              <p class="gbif-advisory">Specimen summaries of more than 500 images may not perform well.
                Please narrow your search or use the download-subset option below.
                <strong>500 images is the maximum per import.</strong></p>
              <p>Found <strong>${info.found}</strong> imaged specimen(s)${already}.</p>
              ${capNote}
              ${dupBlock}
              ${noPending ? '<p class="muted">All of these are already imported into this project — nothing new to download.</p>' : `
              <div class="gbif-subset-row">
                <label>Random subset of
                  <input type="number" id="gbif-subset-n" min="1" max="${maxN}" value="${defN}" />
                  of ${info.pending} new image(s)
                </label>
              </div>`}
            </div>
            <div class="modal-actions">
              <button class="btn ghost sm" data-act="cancel">Cancel</button>
              ${noPending ? '' : `<button class="btn ghost sm" data-act="subset">Download subset</button>`}
              ${noPending ? '' : `<button class="btn sm" data-act="all">Download all ${info.pending}</button>`}
            </div>
          </div>
        </div>`;

      const q = (s) => rootEl.querySelector(s);
      const bd = q('[data-backdrop]');
      bd.addEventListener('click', (e) => { if (e.target === bd) done(null); });
      const cancel = q('[data-act="cancel"]'); if (cancel) cancel.addEventListener('click', () => done(null));
      const allBtn = q('[data-act="all"]'); if (allBtn) allBtn.addEventListener('click', () => done({ mode: 'all' }));
      const subBtn = q('[data-act="subset"]');
      if (subBtn) subBtn.addEventListener('click', () => {
        const inp = q('#gbif-subset-n');
        let n = parseInt(inp && inp.value, 10);
        if (!Number.isFinite(n) || n < 1) n = defN;
        done({ mode: 'subset', n: Math.min(n, maxN) });
      });
      document.addEventListener('keydown', onKey);
    });
  }

  // Download + save in parallel with a bounded worker pool (up to 16 at once,
  // matching the VVGO concurrency). A search's images are spread across many
  // institution hosts, so concurrency parallelises across them rather than
  // hammering one. Workers pull from a shared cursor; JS is single-threaded so
  // the counter increments and tallies are race-free.
  async function runBulk(items) {
    state.bulk = { running: true, cancel: false };
    showBulk();
    updateActionButtons();
    await window.IRIS.api.gbif.setCapture(true); // silently capture attachment-style images
    const total = items.length;
    let cursor = 0, completed = 0, ok = 0, skip = 0, fail = 0;
    updateBulk(0, total, { ok, skip, fail });

    const worker = async (workerIdx) => {
      // Small startup stagger so 16 navigations don't fire in the same tick.
      await sleep(workerIdx * 80);
      while (!state.bulk.cancel) {
        const i = cursor++;
        if (i >= total) break;
        const it = items[i];
        try {
          const dataUrl = await fetchImageBytes(it.image_url);
          const row = await window.IRIS.api.gbif.saveImport(state.projectId, it.gbif_id, dataUrl);
          if (row && row.duplicate) skip++; else ok++;
        } catch (_) {
          fail++;
        }
        completed++;
        updateBulk(completed, total, { ok, skip, fail });
      }
    };

    const n = Math.min(BULK_CONCURRENCY, total);
    await Promise.all(Array.from({ length: n }, (_, k) => worker(k)));
    window.IRIS.api.gbif.setCapture(false);

    const cancelled = state.bulk.cancel;
    state.bulk = { running: false, cancel: false };
    hideBulk();
    updateActionButtons();
    window.IRIS.toast(
      `Import ${cancelled ? 'cancelled' : 'complete'}: ${ok} added` +
      `${skip ? `, ${skip} skipped` : ''}${fail ? `, ${fail} failed` : ''}.`,
      (fail && !ok) ? 'error' : undefined
    );
  }

  function showBulk() {
    const c = state.container; if (!c) return;
    const p = c.querySelector('#gbif-progress');
    if (p) p.hidden = false;
    const btn = c.querySelector('#gbif-progress-cancel');
    if (btn) { btn.disabled = false; btn.textContent = 'Cancel'; }
    const fill = c.querySelector('#gbif-progress-fill');
    if (fill) fill.style.width = '0%';
  }
  function hideBulk() {
    const p = state.container && state.container.querySelector('#gbif-progress');
    if (p) p.hidden = true;
  }
  function updateBulk(completed, total, tally) {
    const c = state.container; if (!c) return;
    const pct = total ? Math.round(completed / total * 100) : 0;
    const fill = c.querySelector('#gbif-progress-fill');
    const text = c.querySelector('#gbif-progress-text');
    const sub = c.querySelector('#gbif-progress-sub');
    if (fill) fill.style.width = `${pct}%`;
    if (text) text.textContent = `Importing ${completed} of ${total}…`;
    if (sub) sub.textContent =
      `${tally.ok} added${tally.skip ? `, ${tally.skip} skipped` : ''}` +
      `${tally.fail ? `, ${tally.fail} failed` : ''} · up to ${Math.min(BULK_CONCURRENCY, total)} at once`;
  }

  // --- bookmarks (saved GBIF searches) -------------------------------------
  async function loadBookmarks() {
    try { state.bookmarks = await window.IRIS.api.gbif.bookmarks(state.projectId); }
    catch (_) { state.bookmarks = []; }
    renderBookmarksMenu();
  }

  function renderBookmarksMenu() {
    const menu = state.container && state.container.querySelector('#gbif-bm-menu');
    if (!menu) return;
    const bms = state.bookmarks;
    menu.innerHTML = bms.length
      ? bms.map(b => `
          <div class="split-menu-item" data-bm-url="${esc(b.url)}" title="${esc(b.url)}">
            <span class="bm-label">${esc(b.label || b.url)}</span>
            <button class="bm-del" data-bm-del="${b.id}" title="Remove bookmark">✕</button>
          </div>`).join('')
      : '<div class="split-menu-empty">No saved searches yet.</div>';
    menu.querySelectorAll('[data-bm-url]').forEach(el => el.addEventListener('click', (e) => {
      if (e.target.closest('[data-bm-del]')) return;
      state.view.loadURL(el.dataset.bmUrl);
      toggleMenu(false);
    }));
    menu.querySelectorAll('[data-bm-del]').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await window.IRIS.api.gbif.removeBookmark(Number(b.dataset.bmDel));
        await loadBookmarks();
      } catch (err) { window.IRIS.toast(err.message, 'error'); }
    }));
  }

  async function bookmarkCurrent() {
    const url = state.view && state.view.getURL();
    if (!url || !/^https?:/i.test(url)) { window.IRIS.toast('Browse GBIF first, then bookmark.', 'error'); return; }
    try {
      const bm = await window.IRIS.api.gbif.bookmark(state.projectId, url);
      await loadBookmarks();
      window.IRIS.toast(bm.duplicate ? 'Already bookmarked.' : 'Search bookmarked.');
    } catch (err) { window.IRIS.toast(err.message, 'error'); }
  }

  function toggleMenu(open) {
    const menu = state.container && state.container.querySelector('#gbif-bm-menu');
    if (!menu) return;
    state.menuOpen = open == null ? !state.menuOpen : open;
    menu.hidden = !state.menuOpen;
    if (state.menuOpen) document.addEventListener('mousedown', onDocClick);
    else document.removeEventListener('mousedown', onDocClick);
  }
  // Close the dropdown on any click outside the split button.
  function onDocClick(e) {
    const split = state.container && state.container.querySelector('#gbif-bm');
    if (split && split.contains(e.target)) return;
    toggleMenu(false);
  }

  function wire() {
    const c = state.container;
    const view = c.querySelector('#gbif-view');
    state.view = view;

    c.querySelector('#gbif-back').addEventListener('click', () => { if (view.canGoBack()) view.goBack(); });
    c.querySelector('#gbif-fwd').addEventListener('click', () => { if (view.canGoForward()) view.goForward(); });
    c.querySelector('#gbif-reload').addEventListener('click', () => view.reload());
    c.querySelector('#gbif-home').addEventListener('click', () => view.loadURL(HOME));
    c.querySelector('#gbif-add').addEventListener('click', addToLibrary);
    c.querySelector('#gbif-import').addEventListener('click', importFromSearch);
    c.querySelector('#gbif-progress-cancel').addEventListener('click', () => {
      state.bulk.cancel = true;
      const btn = c.querySelector('#gbif-progress-cancel');
      if (btn) { btn.disabled = true; btn.textContent = 'Cancelling…'; }
    });
    c.querySelector('#gbif-bm-add').addEventListener('click', bookmarkCurrent);
    c.querySelector('#gbif-bm-toggle').addEventListener('click', () => toggleMenu());

    const url = c.querySelector('#gbif-url');
    url.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      let v = url.value.trim();
      if (!v) return;
      // Bare occurrence id / URL both work; otherwise treat as a GBIF page URL.
      if (/^\d+$/.test(v)) v = `https://www.gbif.org/occurrence/${v}`;
      else if (!/^https?:\/\//i.test(v)) v = `https://www.gbif.org/occurrence/search?q=${encodeURIComponent(v)}`;
      view.loadURL(v);
    });

    view.addEventListener('did-navigate', (e) => onNav(e.url));
    view.addEventListener('did-navigate-in-page', (e) => onNav(e.url));
    view.addEventListener('did-stop-loading', () => onNav(view.getURL()));
    view.addEventListener('page-title-updated', () => onNav(view.getURL()));
  }

  function mount(container) {
    state.container = container;
    ensureDownloadListener();
    const active = window.IRIS.session.getCurrentProject();
    if (!active) {
      window.IRIS.ProjectPage.noProjectPlaceholder(container, {
        title: 'GBIF', subtitle: 'browse GBIF & import specimens into a project',
      });
      return;
    }
    state.projectId = active.id;
    state.busy = false;
    state.currentId = null;

    container.innerHTML = `
      <div class="page-toolbar gbif-toolbar">
        ${window.IRIS.pageHeader({ label: 'GBIF', name: active.name, meta: 'Browse gbif.org · import specimens' })}
        <div class="spacer"></div>
        <div class="split-btn" id="gbif-bm">
          <button class="btn ghost sm split-main" id="gbif-bm-add" title="Save the current GBIF search">☆ Bookmark this Search</button>
          <button class="btn ghost sm split-caret" id="gbif-bm-toggle" title="Saved searches" aria-label="Saved searches">▾</button>
          <div class="split-menu" id="gbif-bm-menu" hidden></div>
        </div>
        <button class="btn ghost" id="gbif-import" disabled>⤓ Import…</button>
        <button class="btn" id="gbif-add" disabled>＋ Add to Library</button>
      </div>
      <div class="gbif-chrome">
        <div class="gbif-nav">
          <button class="btn ghost sm icon-btn" id="gbif-back" title="Back">‹</button>
          <button class="btn ghost sm icon-btn" id="gbif-fwd" title="Forward">›</button>
          <button class="btn ghost sm icon-btn" id="gbif-reload" title="Reload">⟳</button>
          <button class="btn ghost sm icon-btn" id="gbif-home" title="GBIF specimen gallery">⌂</button>
        </div>
        <input class="input sm gbif-urlbar" id="gbif-url" placeholder="Search GBIF, or paste an occurrence URL / ID…" />
        <span class="gbif-status mono small" id="gbif-status"></span>
      </div>
      <div class="page-body gbif-body">
        <webview id="gbif-view" class="gbif-view" src="${esc(HOME)}" partition="persist:gbif" allowpopups></webview>
        <div class="gbif-progress" id="gbif-progress" hidden>
          <div class="gbif-progress-head">
            <span id="gbif-progress-text">Importing…</span>
            <button class="btn ghost sm" id="gbif-progress-cancel">Cancel</button>
          </div>
          <div class="gbif-progress-track"><div class="gbif-progress-fill" id="gbif-progress-fill"></div></div>
          <div class="gbif-progress-sub mono small" id="gbif-progress-sub"></div>
        </div>
      </div>
    `;
    wire();
    updateActionButtons();
    loadBookmarks();
  }

  window.IRIS = window.IRIS || {};
  window.IRIS.GbifPage = { mount, _promptImport: promptImport };
})();
