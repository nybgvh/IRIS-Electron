/*
 * Library tab (module id kept as SourcesPage so the router mapping is stable;
 * the tab label reads "Library").
 *
 * An "item" is a source joined with its VoucherVision extraction + tags
 * (server: item-service.list). The Library shows every item in the active
 * project as a gallery grid or a dense list, with:
 *   - upload (drag/drop or picker), auto-processed by VoucherVisionGO
 *   - per-item processing status (pending / complete / errored)
 *   - facets: source type, status, and project tags (+ text search)
 *   - a detail drawer: 3 images (original / full / cropped), OCR, the
 *     formatted_json, a tag editor, reprocess, move, delete
 *   - multi-select + bulk tag / delete / reprocess / "summarize selected"
 *
 * Capability gating mirrors shared/capabilities.js (the server re-checks
 * everything; this only hides controls the role can't use).
 */

(function () {
  const state = {
    container: null,
    projectId: null,
    role: null,          // effective project role: owner|editor|uploader (admin→owner)
    items: [],
    tags: [],
    view: 'rows',        // 'rows' (rich, default) | 'grid' (gallery)
    filters: { type: 'all', status: 'all', search: '', tagIds: new Set() },
    selected: new Set(), // source_ids
    detailId: null,      // source_id open in the drawer
    imgKind: 'original', // detail image switcher
    pollTimer: null,
  };

  // Keyed by upload origin (itemOrigin): specimen images, notebook pages, PDF pages.
  const SOURCE_GLYPH = { specimen: '🌿', image: '🌿', notebook: '📓', pdf: '📄' };
  const UPLOAD_OPTIONS = [
    { value: 'image',    label: 'Specimen Image' },
    { value: 'notebook', label: 'Field Notebook' },
    { value: 'pdf',      label: 'PDF / Book / Manual' },
  ];
  const STATUS_META = {
    none:     ['status-none',    'Not processed'],
    pending:  ['status-pending', 'Processing…'],
    complete: ['status-complete','Complete'],
    errored:  ['status-errored', 'Failed'],
  };

  // Capability mirror (UI hint only; server enforces).
  const CAPS = {
    owner:    new Set(['upload', 'delete', 'tag', 'assess']),
    editor:   new Set(['upload', 'delete', 'tag', 'assess']),
    uploader: new Set(['upload']),
  };
  const can = (cap) => !!(state.role && CAPS[state.role] && CAPS[state.role].has(cap));

  // --- helpers -------------------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
    }[c]));
  }
  function syntaxJSON(obj) {
    const json = JSON.stringify(obj || {}, null, 2);
    return escapeHtml(json)
      .replace(/&quot;([^&]+?)&quot;(\s*:)/g, '<span class="json-key">&quot;$1&quot;</span>$2')
      .replace(/: &quot;([^&]*?)&quot;/g, ': <span class="json-string">&quot;$1&quot;</span>')
      .replace(/: (-?\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
      .replace(/: (true|false)/g, ': <span class="json-bool">$1</span>')
      .replace(/: (null)/g, ': <span class="json-null">$1</span>');
  }
  function iucnBadge(cat) {
    const known = ['EX','EW','CR','EN','VU','NT','LC','DD','NE'];
    if (cat && known.includes(cat)) return `<span class="specimen-badge iucn-${cat}">${cat}</span>`;
    return '';
  }
  function statusBadge(st) {
    const [cls, label] = STATUS_META[st] || STATUS_META.none;
    const spin = st === 'pending' ? '<span class="spin"></span>' : '';
    return `<span class="status-badge ${cls}">${spin}${label}</span>`;
  }
  function itemTitle(it) {
    return it.scientific_name || it.filename;
  }
  function itemThumb(it) {
    // Prefer the cropped label collage, then the full, then the original.
    if (it.has_cropped_image && it.vv_id) return `iris-source://vv/${it.vv_id}/cropped`;
    if (it.has_full_image && it.vv_id)    return `iris-source://vv/${it.vv_id}/full`;
    if ((it.mime_type || '').startsWith('image/')) return `iris-source://source/${it.source_id}`;
    return null;
  }

  // --- network -------------------------------------------------------------
  async function loadRole() {
    const user = window.IRIS.session.get();
    if (user && user.role === 'admin') { state.role = 'owner'; return; }
    try {
      const members = await window.IRIS.api.members.list(state.projectId);
      const mine = members.find(m => Number(m.user_id) === Number(user.id));
      state.role = mine ? mine.role : null;
    } catch (_) { state.role = null; }
  }

  async function loadAll() {
    if (!state.projectId) { state.items = []; state.tags = []; return; }
    try {
      const [items, tags] = await Promise.all([
        window.IRIS.api.items.list(state.projectId, {}),
        window.IRIS.api.tags.list(state.projectId),
      ]);
      state.items = items;
      state.tags = tags;
    } catch (err) {
      state.items = []; state.tags = [];
      window.IRIS.toast(`Could not load library: ${err.message}`, 'error');
    }
  }

  async function refresh() {
    await loadAll();
    renderBody();
    schedulePoll();
  }

  // Poll while anything is still processing so status badges settle live.
  function schedulePoll() {
    const anyPending = state.items.some(it => it.vv_status === 'pending');
    if (state.pollTimer) { clearTimeout(state.pollTimer); state.pollTimer = null; }
    if (anyPending && document.getElementById('library-root')) {
      state.pollTimer = setTimeout(refresh, 3000);
    }
  }

  // SHA-256 of raw bytes as hex (Web Crypto). Returns null if unavailable
  // (non-secure context) so the flow degrades to server-side silent dedup.
  async function sha256Hex(arrayBuffer) {
    try {
      if (!(window.crypto && window.crypto.subtle)) return null;
      const digest = await window.crypto.subtle.digest('SHA-256', arrayBuffer);
      return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) { return null; }
  }

  async function uploadFiles(files, sourceType) {
    if (!files || !files.length || !state.projectId) return;
    const pid = state.projectId;

    // Read + hash every file so we can detect duplicates before transferring.
    const entries = [];
    for (const f of files) {
      const buffer = await f.arrayBuffer();
      entries.push({ file: f, buffer, hash: await sha256Hex(buffer) });
    }

    // Ask the server which of these files are already in this project.
    let dupHashes = new Set();
    const hashes = entries.map(e => e.hash).filter(Boolean);
    if (hashes.length) {
      try { dupHashes = new Set(await window.IRIS.api.sources.checkDuplicates(pid, hashes)); }
      catch (_) { /* precheck unavailable → fall through to server dedup */ }
    }
    const dups = entries.filter(e => e.hash && dupHashes.has(e.hash));
    const fresh = entries.filter(e => !(e.hash && dupHashes.has(e.hash)));

    // Default: upload the new files. If some are duplicates, ask the user.
    let toUpload = fresh.map(e => ({ e, force: false }));
    if (dups.length) {
      const list = dups.map(e => `<li>${escapeHtml(e.file.name)}</li>`).join('');
      const choice = await window.IRIS.dialog({
        title: 'Duplicate uploads detected',
        message: `<p><strong>${dups.length}</strong> of these file${dups.length === 1 ? ' is' : 's are'}
          already in this project:</p><ul>${list}</ul>
          <p>${fresh.length ? `${fresh.length} other file${fresh.length === 1 ? ' is' : 's are'} new. ` : ''}
          Re-upload the duplicate${dups.length === 1 ? '' : 's'} anyway?</p>`,
        buttons: [
          { label: fresh.length ? `Skip duplicates (upload ${fresh.length} new)` : 'Skip duplicates', value: 'skip', variant: 'primary' },
          { label: `Upload anyway`, value: 'force' },
          { label: 'Cancel', value: null, variant: 'ghost' },
        ],
      });
      if (choice === null) return;                       // cancel: upload nothing
      if (choice === 'force') toUpload = toUpload.concat(dups.map(e => ({ e, force: true })));
      // 'skip': leave toUpload as the fresh files only
    }

    if (!toUpload.length) { window.IRIS.toast('Nothing to upload — all selected files are duplicates.'); return; }

    let ok = 0, pdfCount = 0, pageTotal = 0;
    for (const { e, force } of toUpload) {
      try {
        const res = await window.IRIS.api.sources.upload(pid, {
          filename: e.file.name, mime_type: e.file.type || 'application/octet-stream',
          buffer: e.buffer, source_type: sourceType, force,
        });
        ok++;
        if (res && res.pdf) { pdfCount++; pageTotal += res.pageCount || (res.pages ? res.pages.length : 0); }
      } catch (err) {
        window.IRIS.toast(`Upload failed: ${e.file.name} — ${err.message}`, 'error');
      }
    }
    if (ok) {
      const extra = pdfCount ? ` (${pageTotal} page${pageTotal === 1 ? '' : 's'} from ${pdfCount} PDF${pdfCount === 1 ? '' : 's'})` : '';
      window.IRIS.toast(`Uploaded ${ok} file${ok === 1 ? '' : 's'}${extra} — processing…`);
    }
    refresh();
  }

  // --- filtering -----------------------------------------------------------
  function visibleItems() {
    const f = state.filters;
    const term = (f.search || '').toLowerCase().trim();
    return state.items.filter(it => {
      if (f.type !== 'all' && itemOrigin(it) !== f.type) return false;
      if (f.status !== 'all' && (it.vv_status || 'none') !== f.status) return false;
      if (f.tagIds.size) {
        const ids = new Set((it.tags || []).map(t => t.id));
        for (const tid of f.tagIds) if (!ids.has(tid)) return false; // AND
      }
      if (term) {
        const hay = [it.filename, it.scientific_name, it.ocr_text,
          (it.metadata || {}).locality, (it.metadata || {}).country]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }

  // --- render: shell -------------------------------------------------------
  function renderShell(container) {
    const active = window.IRIS.session.getCurrentProject();
    container.innerHTML = `
      <div id="library-root">
        <div class="page-toolbar">
          ${window.IRIS.pageHeader({ label: 'Library', name: active ? active.name : 'No project', meta: libraryMeta() })}
          <div class="spacer"></div>
          <div class="view-toggle">
            <button class="chip ${state.view === 'rows' ? 'active' : ''}" data-view="rows" title="Rows">☰</button>
            <button class="chip ${state.view === 'grid' ? 'active' : ''}" data-view="grid" title="Gallery">▦</button>
          </div>
          <button class="btn ghost sm" id="refresh-btn">Refresh</button>
          ${can('upload') ? `
            <input type="file" id="file-input" accept="image/*,application/pdf" multiple hidden />
            <select class="select sm" id="upload-type" style="width:auto;min-width:150px;">
              ${UPLOAD_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
            </select>
            <button class="btn sm" id="upload-btn">Upload</button>` : ''}
        </div>

        <div class="library-facets" id="facets"></div>
        <div class="library-bulkbar" id="bulkbar"></div>
        <div class="library-body" id="library-body"></div>
      </div>
      <div class="item-drawer" id="item-drawer"></div>
    `;

    container.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
      state.view = b.dataset.view; renderShell(container); renderBody();
    }));
    const refreshBtn = container.querySelector('#refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', refresh);

    if (can('upload')) {
      const fileInput = container.querySelector('#file-input');
      container.querySelector('#upload-btn').addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const files = Array.from(fileInput.files || []);
        await uploadFiles(files, container.querySelector('#upload-type').value);
        fileInput.value = '';
      });
    }
    renderFacets();
  }

  // --- render: facets ------------------------------------------------------
  function renderFacets() {
    const el = document.getElementById('facets');
    if (!el) return;
    const f = state.filters;
    const typeChip = (v, label) =>
      `<button class="chip ${f.type === v ? 'active' : ''}" data-type="${v}">${label}</button>`;
    const statusChip = (v, label) =>
      `<button class="chip ${f.status === v ? 'active' : ''}" data-status="${v}">${label}</button>`;
    const tagChip = (t) =>
      `<button class="chip tag-chip ${f.tagIds.has(t.id) ? 'active' : ''}" data-tag="${t.id}"
         style="${t.color ? `--tag:${escapeHtml(t.color)}` : ''}">
         ${escapeHtml(t.name)} <span class="tag-count">${t.usage_count}</span></button>`;

    el.innerHTML = `
      <div class="facet-group">
        <span class="facet-label">Type</span>
        ${typeChip('all','All')}${typeChip('specimen','Specimens')}${typeChip('notebook','Notebooks')}${typeChip('pdf','PDFs')}
      </div>
      <div class="facet-group">
        <span class="facet-label">Status</span>
        ${statusChip('all','All')}${statusChip('pending','Processing')}${statusChip('complete','Complete')}${statusChip('errored','Failed')}
      </div>
      <div class="facet-group">
        <span class="facet-label">Tags</span>
        ${state.tags.length ? state.tags.map(tagChip).join('') : '<span class="muted small">none yet</span>'}
        ${can('tag') ? `<button class="chip ghost" id="new-tag-btn" title="Create a tag">+ Tag</button>` : ''}
      </div>
      <div class="facet-group grow">
        <input type="text" class="input sm" id="search-input" placeholder="Search name, locality, OCR…" value="${escapeHtml(f.search)}" />
      </div>
    `;

    el.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => { f.type = b.dataset.type; renderFacets(); renderBody(); }));
    el.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => { f.status = b.dataset.status; renderFacets(); renderBody(); }));
    el.querySelectorAll('[data-tag]').forEach(b => b.addEventListener('click', () => {
      const id = Number(b.dataset.tag);
      if (f.tagIds.has(id)) f.tagIds.delete(id); else f.tagIds.add(id);
      renderFacets(); renderBody();
    }));
    const search = el.querySelector('#search-input');
    if (search) search.addEventListener('input', () => { f.search = search.value; renderBody(); });
    const newTag = el.querySelector('#new-tag-btn');
    if (newTag) newTag.addEventListener('click', createTagPrompt);
  }

  async function createTagPrompt() {
    const name = await window.IRIS.promptText({ title: 'New tag', placeholder: 'Tag name', confirmLabel: 'Create' });
    if (!name) return;
    try {
      await window.IRIS.api.tags.create(state.projectId, { name });
      await loadAll(); renderFacets(); renderBody();
      window.IRIS.toast(`Tag "${name}" created.`);
    } catch (err) { window.IRIS.toast(err.message || 'Could not create tag.', 'error'); }
  }

  // --- render: bulk bar ----------------------------------------------------
  function renderBulkBar() {
    const el = document.getElementById('bulkbar');
    if (!el) return;
    const n = state.selected.size;
    if (n === 0) { el.innerHTML = ''; el.classList.remove('show'); return; }
    el.classList.add('show');
    el.innerHTML = `
      <span class="bulk-count">${n} selected</span>
      <button class="btn ghost sm" data-bulk="clear">Clear</button>
      <div class="spacer"></div>
      ${can('assess') ? `<button class="btn sm" data-bulk="summarize">Summarize ${n} →</button>` : ''}
      ${can('tag') ? `<button class="btn ghost sm" data-bulk="tag">Tag…</button>` : ''}
      ${can('upload') ? `<button class="btn ghost sm" data-bulk="reprocess">Reprocess</button>` : ''}
      ${can('delete') ? `<button class="btn danger sm" data-bulk="delete">Delete</button>` : ''}
    `;
    el.querySelector('[data-bulk="clear"]').addEventListener('click', () => { state.selected.clear(); renderBody(); });
    const byAct = (a) => el.querySelector(`[data-bulk="${a}"]`);
    if (byAct('summarize')) byAct('summarize').addEventListener('click', summarizeSelected);
    if (byAct('tag'))       byAct('tag').addEventListener('click', bulkTag);
    if (byAct('reprocess')) byAct('reprocess').addEventListener('click', bulkReprocess);
    if (byAct('delete'))    byAct('delete').addEventListener('click', bulkDelete);
  }

  function summarizeSelected() {
    const ids = [...state.selected];
    window.IRIS.pendingSummary = { projectId: state.projectId, sourceIds: ids };
    window.IRIS.toast(`${ids.length} item(s) queued for a summary.`);
    const tab = document.querySelector('.tab[data-tab="assessment"]');
    if (tab) tab.click();
  }

  async function bulkTag() {
    const name = await window.IRIS.promptText({
      title: `Tag ${state.selected.size} item(s)`,
      label: 'Type an existing tag name, or a new one to create it.',
      placeholder: 'Tag name', confirmLabel: 'Apply',
    });
    if (!name) return;
    try {
      let tag = state.tags.find(t => t.name.toLowerCase() === name.toLowerCase());
      if (!tag) tag = await window.IRIS.api.tags.create(state.projectId, { name });
      for (const sid of state.selected) await window.IRIS.api.tags.assign(sid, tag.id);
      await loadAll(); renderFacets(); renderBody();
      window.IRIS.toast(`Tagged ${state.selected.size} item(s).`);
    } catch (err) { window.IRIS.toast(err.message || 'Bulk tag failed.', 'error'); }
  }

  async function bulkReprocess() {
    if (!confirm(`Re-run VoucherVision on ${state.selected.size} item(s)?`)) return;
    let ok = 0;
    for (const sid of state.selected) {
      try { await window.IRIS.api.vouchervision.reprocess(sid); ok++; } catch (_) {}
    }
    window.IRIS.toast(`Reprocessing ${ok} item(s).`);
    refresh();
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${state.selected.size} item(s)? This removes the images, OCR, and extraction.`)) return;
    let ok = 0;
    for (const sid of state.selected) {
      try { await window.IRIS.api.sources.delete(sid); ok++; } catch (_) {}
    }
    state.selected.clear();
    window.IRIS.toast(`Deleted ${ok} item(s).`);
    refresh();
  }

  // --- render: body (grid | list) ------------------------------------------
  // Header meta line — live item + processed counts (updated as data loads).
  function libraryMeta() {
    const n = state.items.length;
    if (!n) return 'Specimen library';
    const done = state.items.filter(it => (it.vv_status || '') === 'complete').length;
    return `${n} item${n === 1 ? '' : 's'} · ${done} processed`;
  }
  function updateLibraryMeta() {
    const el = state.container && state.container.querySelector('.page-hd-meta');
    if (el) el.textContent = libraryMeta();
  }

  function renderBody() {
    updateLibraryMeta();
    const body = document.getElementById('library-body');
    if (!body) return;
    const list = visibleItems();
    // prune selection to visible ids that still exist
    const liveIds = new Set(state.items.map(i => i.source_id));
    for (const sid of [...state.selected]) if (!liveIds.has(sid)) state.selected.delete(sid);

    renderBulkBar();

    if (list.length === 0) {
      body.className = 'library-body';
      body.innerHTML = `<div class="empty-list">
        ${state.items.length === 0
          ? '“In every walk with nature, one receives far more than he seeks.”<br/>Upload a specimen image to begin.'
          : 'No items match these filters.'}
      </div>`;
      return;
    }

    body.className = `library-body ${state.view === 'grid' ? 'as-grid' : 'as-rows'}`;
    body.innerHTML = state.view === 'grid'
      ? list.map(renderCard).join('')
      : list.map(renderFullRow).join('');
    wireItemEvents(body);
  }

  function selectBox(it) {
    return `<label class="pick" onclick="event.stopPropagation()">
      <input type="checkbox" data-pick="${it.source_id}" ${state.selected.has(it.source_id) ? 'checked' : ''}/>
    </label>`;
  }
  function tagPills(it) {
    return (it.tags || []).map(t =>
      `<span class="tag-pill" style="${t.color ? `--tag:${escapeHtml(t.color)}` : ''}">${escapeHtml(t.name)}</span>`
    ).join('');
  }

  function renderCard(it) {
    const thumb = itemThumb(it);
    const st = it.vv_status || 'none';
    const cat = it.formatted && (it.formatted.redListCategory || it.formatted.iucn);
    return `
      <div class="item-card ${state.selected.has(it.source_id) ? 'picked' : ''} ${it.flagged ? 'flagged' : ''} ${state.detailId === it.source_id ? 'open' : ''}" data-id="${it.source_id}">
        ${selectBox(it)}
        ${it.flagged ? '<span class="flag-overlay" title="Flagged">⚑</span>' : ''}
        <div class="item-thumb" style="${thumb ? `background-image:url('${thumb}')` : ''}">
          ${thumb ? '' : (SOURCE_GLYPH[itemOrigin(it)] || '◆')}
        </div>
        <div class="item-card-body">
          <div class="item-name">${escapeHtml(itemTitle(it))}</div>
          <div class="item-sub mono small">${escapeHtml(it.filename)}</div>
          <div class="item-badges">
            ${statusBadge(st)}${iucnBadge(cat)}${tagPills(it)}
          </div>
        </div>
      </div>`;
  }

  // Available image URLs for an item (original / VVGO full / VVGO cropped).
  function imgSources(it) {
    const isImg = (it.mime_type || '').startsWith('image/');
    return {
      original: isImg ? `iris-source://source/${it.source_id}` : null,
      full:     (it.has_full_image && it.vv_id) ? `iris-source://vv/${it.vv_id}/full` : null,
      cropped:  (it.has_cropped_image && it.vv_id) ? `iris-source://vv/${it.vv_id}/cropped` : null,
    };
  }

  // camelCase / snake_case field name → readable label (e.g. scientificName →
  // "Scientific Name", minimumElevationInMeters → "Minimum Elevation In Meters").
  function humanizeKey(k) {
    return String(k)
      .replace(/_/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .replace(/^./, c => c.toUpperCase());
  }

  // Upload origin of an item — what the user actually uploaded. Every stored row
  // is now source_type 'image' (PDF/notebook uploads are exploded into per-page
  // image rows, each stamped with metadata.origin); direct specimen uploads have
  // no origin, so they read as 'specimen'. This drives the Library TYPE filter.
  function itemOrigin(it) {
    const o = it && it.metadata && it.metadata.origin;
    return (o === 'pdf' || o === 'notebook') ? o : 'specimen';
  }

  // A page rasterised from a PDF / notebook. These are processed OCR-only, so
  // they never carry structured formatted_json — the UI shows OCR alone and
  // skips the (empty) extracted-fields panel instead of showing "No fields".
  function isDocPage(it) {
    return itemOrigin(it) !== 'specimen';
  }

  // Render formatted_json as a styled label/value list (not code). Only shows
  // populated scalar fields; nested/empty fields are skipped for readability.
  function renderFields(formatted) {
    if (!formatted || typeof formatted !== 'object') {
      return '<div class="muted small">Not available yet.</div>';
    }
    const rows = Object.entries(formatted).filter(([, v]) =>
      v != null && v !== '' && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'));
    if (!rows.length) return '<div class="muted small">No fields extracted.</div>';
    return `<div class="field-grid">${rows.map(([k, v]) => `
      <div class="field-row">
        <div class="field-key">${escapeHtml(humanizeKey(k))}</div>
        <div class="field-val">${escapeHtml(String(v))}</div>
      </div>`).join('')}</div>`;
  }

  // Rich full-width row: big image + original/full/crop toggle on the left,
  // OCR + extracted-field panels on the right.
  function renderFullRow(it) {
    const st = it.vv_status || 'none';
    const { original, full, cropped } = imgSources(it);
    const kinds = [];
    if (original) kinds.push(['original', 'Original', original]);
    if (full)     kinds.push(['full', 'Full', full]);
    if (cropped)  kinds.push(['cropped', 'Crop', cropped]);
    const startKind = cropped ? 'cropped' : (full ? 'full' : 'original');
    const start = cropped || full || original;
    const cat = it.formatted && (it.formatted.redListCategory || it.formatted.iucn);

    const media = start
      ? `<img class="fr-img" id="fr-img-${it.source_id}" src="${start}" data-active="${startKind}"
            data-original="${original || ''}" data-full="${full || ''}" data-cropped="${cropped || ''}"
            alt="${escapeHtml(itemTitle(it))}" draggable="false" />`
      : `<div class="fr-img-empty">${SOURCE_GLYPH[itemOrigin(it)] || '◆'}</div>`;
    const toggle = kinds.length > 1
      ? `<div class="fr-imgtoggle" data-sid="${it.source_id}">${kinds.map(([k, label]) =>
          `<button class="chip ${k === startKind ? 'active' : ''}" data-frk="${k}">${label}</button>`).join('')}</div>`
      : '';

    return `
      <div class="item-fullrow ${state.selected.has(it.source_id) ? 'picked' : ''} ${it.flagged ? 'flagged' : ''} ${state.detailId === it.source_id ? 'open' : ''}" data-id="${it.source_id}">
        <div class="fr-media">
          <div class="fr-image">
            ${selectBox(it)}
            ${it.flagged ? '<span class="flag-overlay" title="Flagged">⚑</span>' : ''}
            ${media}
          </div>
          ${toggle}
        </div>
        <div class="fr-body">
          <div class="fr-head">
            <div class="fr-headline">
              <div class="item-name">${escapeHtml(itemTitle(it))}</div>
              <div class="item-sub mono small">${escapeHtml(it.filename)}</div>
            </div>
            <div class="fr-badges">${statusBadge(st)}${iucnBadge(cat)}${tagPills(it)}</div>
          </div>
          <div class="fr-panels ${isDocPage(it) ? 'single' : ''}">
            <div class="fr-panel">
              <div class="fr-panel-head">OCR text${isDocPage(it) ? ' <span class="muted small">· document page</span>' : ''}</div>
              <div class="ocr-box">${it.ocr_text ? escapeHtml(it.ocr_text)
                : (st === 'pending' ? 'Processing…' : (st === 'errored' ? `<span class="muted small">${escapeHtml(it.error_message || 'Failed.')}</span>` : '<span class="muted small">Not available.</span>'))}</div>
            </div>
            ${isDocPage(it) ? '' : `
            <div class="fr-panel">
              <div class="fr-panel-head">Extracted fields</div>
              ${renderFields(it.formatted)}
            </div>`}
          </div>
        </div>
      </div>`;
  }

  function wireItemEvents(body) {
    body.querySelectorAll('[data-pick]').forEach(cb => cb.addEventListener('change', () => {
      const sid = Number(cb.dataset.pick);
      if (cb.checked) state.selected.add(sid); else state.selected.delete(sid);
      renderBulkBar();
      const card = body.querySelector(`[data-id="${sid}"]`);
      if (card) card.classList.toggle('picked', cb.checked);
    }));

    // rich-row image toggle (Original / Full / Crop) — swaps src inline
    body.querySelectorAll('.fr-imgtoggle').forEach(tg => {
      const sid = Number(tg.dataset.sid);
      tg.querySelectorAll('[data-frk]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const img = document.getElementById(`fr-img-${sid}`);
        if (!img) return;
        const src = img.dataset[b.dataset.frk];
        if (src) { img.src = src; img.dataset.active = b.dataset.frk; }
        tg.querySelectorAll('[data-frk]').forEach(x => x.classList.toggle('active', x === b));
      }));
    });

    // rich-row image click → fullscreen lightbox
    body.querySelectorAll('.fr-img').forEach(img => {
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        const images = [];
        if (img.dataset.original) images.push({ key: 'original', label: 'Original', src: img.dataset.original });
        if (img.dataset.full)     images.push({ key: 'full', label: 'Full', src: img.dataset.full });
        if (img.dataset.cropped)  images.push({ key: 'cropped', label: 'Crop', src: img.dataset.cropped });
        if (!images.length) return;
        const sid = Number(img.id.replace('fr-img-', ''));
        const it = state.items.find(i => i.source_id === sid);
        window.IRIS.Lightbox.open({ images, activeKey: img.dataset.active || images[0].key, title: it ? itemTitle(it) : '' });
      });
    });

    // clicking a row (but not the media / checkbox) opens the detail drawer
    body.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', (e) => {
      if (e.target.closest('.pick') || e.target.closest('.fr-media')) return;
      openDrawer(Number(el.dataset.id));
    }));
  }

  // --- detail drawer -------------------------------------------------------
  function openDrawer(sourceId) {
    state.detailId = sourceId;
    state.imgKind = 'original';
    renderDrawer();
    renderBody();
  }
  function closeDrawer() { state.detailId = null; renderDrawer(); renderBody(); }

  function renderDrawer() {
    const el = document.getElementById('item-drawer');
    if (!el) return;
    if (!state.detailId) { el.classList.remove('open'); el.innerHTML = ''; return; }
    const it = state.items.find(i => i.source_id === state.detailId);
    if (!it) { closeDrawer(); return; }
    el.classList.add('open');

    const imgs = [];
    if ((it.mime_type || '').startsWith('image/')) imgs.push(['original', 'Original', `iris-source://source/${it.source_id}`]);
    else if (it.mime_type === 'application/pdf')   imgs.push(['original', 'Document', `iris-source://source/${it.source_id}`]);
    if (it.has_full_image)    imgs.push(['full', 'Full', `iris-source://vv/${it.vv_id}/full`]);
    if (it.has_cropped_image) imgs.push(['cropped', 'Cropped', `iris-source://vv/${it.vv_id}/cropped`]);
    if (!imgs.find(i => i[0] === state.imgKind)) state.imgKind = imgs[0] ? imgs[0][0] : 'original';
    const activeImg = imgs.find(i => i[0] === state.imgKind);

    const assignedIds = new Set((it.tags || []).map(t => t.id));
    const availableTags = state.tags.filter(t => !assignedIds.has(t.id));

    el.innerHTML = `
      <div class="drawer-head">
        <div class="drawer-title">
          <div class="item-name">${escapeHtml(itemTitle(it))}</div>
          <div class="mono small">${escapeHtml(it.filename)}</div>
        </div>
        <button class="icon-btn" id="drawer-close" title="Close">✕</button>
      </div>

      <div class="drawer-status">${statusBadge(it.vv_status || 'none')}
        ${it.vv_status === 'errored' && it.error_message ? `<span class="err-msg">${escapeHtml(it.error_message)}</span>` : ''}
      </div>

      <div class="drawer-image">
        ${activeImg
          ? (it.mime_type === 'application/pdf' && state.imgKind === 'original'
              ? `<embed src="${activeImg[2]}" type="application/pdf" />`
              : `<img src="${activeImg[2]}" alt="${escapeHtml(itemTitle(it))}" />`)
          : `<div class="drawer-noimg">No image</div>`}
      </div>
      ${imgs.length > 1 ? `<div class="img-switch">
        ${imgs.map(([k, label]) => `<button class="chip ${k === state.imgKind ? 'active' : ''}" data-img="${k}">${label}</button>`).join('')}
      </div>` : ''}

      <div class="drawer-section">
        <div class="drawer-section-head">Tags</div>
        <div class="drawer-tags">
          ${(it.tags || []).map(t => `<span class="tag-pill removable" style="${t.color ? `--tag:${escapeHtml(t.color)}` : ''}" data-untag="${t.id}">${escapeHtml(t.name)} ✕</span>`).join('') || '<span class="muted small">none</span>'}
        </div>
        ${can('tag') ? `<div class="drawer-tag-add">
          <select class="select sm" id="tag-add-select">
            <option value="">Add tag…</option>
            ${availableTags.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
            <option value="__new">+ New tag…</option>
          </select>
        </div>` : ''}
      </div>

      <div class="drawer-section">
        <div class="drawer-section-head">OCR text</div>
        <div class="ocr-box">${it.ocr_text ? escapeHtml(it.ocr_text) : '<span class="muted small">Not available yet.</span>'}</div>
      </div>

      <div class="drawer-section">
        <div class="drawer-section-head">Extracted fields (formatted_json)</div>
        <div class="json-viewer">${it.formatted ? syntaxJSON(it.formatted)
          : (isDocPage(it)
              ? '<span class="muted small">Document page — processed OCR-only, no structured fields.</span>'
              : '<span class="muted small">Not available yet.</span>')}</div>
      </div>

      <div class="drawer-actions">
        ${can('tag') ? `<button class="btn ghost sm flag-btn ${it.flagged ? 'on' : ''}" data-act="flag">⚑ ${it.flagged ? 'Flagged' : 'Flag'}</button>` : ''}
        ${can('upload') ? `<button class="btn ghost sm" data-act="reprocess">Reprocess</button>` : ''}
        ${can('delete') ? `<button class="btn ghost sm" data-act="move">Move…</button>` : ''}
        ${can('delete') ? `<button class="btn danger sm" data-act="delete">Delete</button>` : ''}
      </div>
    `;

    el.querySelector('#drawer-close').addEventListener('click', closeDrawer);
    el.querySelectorAll('[data-img]').forEach(b => b.addEventListener('click', () => { state.imgKind = b.dataset.img; renderDrawer(); }));
    const drawerImg = el.querySelector('.drawer-image img');
    if (drawerImg) {
      drawerImg.style.cursor = 'zoom-in';
      drawerImg.addEventListener('click', () => {
        const images = imgs.map(([key, label, src]) => ({ key, label, src }));
        if (images.length) window.IRIS.Lightbox.open({ images, activeKey: state.imgKind, title: itemTitle(it) });
      });
    }
    el.querySelectorAll('[data-untag]').forEach(b => b.addEventListener('click', async () => {
      try { await window.IRIS.api.tags.unassign(it.source_id, Number(b.dataset.untag)); await loadAll(); renderFacets(); renderDrawer(); renderBody(); }
      catch (err) { window.IRIS.toast(err.message, 'error'); }
    }));
    const tagAdd = el.querySelector('#tag-add-select');
    if (tagAdd) tagAdd.addEventListener('change', async () => {
      const v = tagAdd.value;
      if (!v) return;
      try {
        let tagId = Number(v);
        if (v === '__new') {
          tagAdd.value = '';
          const name = await window.IRIS.promptText({ title: 'New tag', placeholder: 'Tag name', confirmLabel: 'Create' });
          if (!name) return;
          const created = await window.IRIS.api.tags.create(state.projectId, { name });
          tagId = created.id;
        }
        await window.IRIS.api.tags.assign(it.source_id, tagId);
        await loadAll(); renderFacets(); renderDrawer(); renderBody();
      } catch (err) { window.IRIS.toast(err.message, 'error'); }
    });
    const act = (a) => el.querySelector(`[data-act="${a}"]`);
    if (act('flag')) act('flag').addEventListener('click', async () => {
      try {
        const updated = await window.IRIS.api.sources.flag(it.source_id, !it.flagged);
        it.flagged = !!updated.flagged;
        const inList = state.items.find(i => i.source_id === it.source_id);
        if (inList) inList.flagged = it.flagged;
        window.IRIS.toast(it.flagged ? 'Flagged.' : 'Unflagged.');
        renderDrawer(); renderBody();
      } catch (err) { window.IRIS.toast(err.message, 'error'); }
    });
    if (act('reprocess')) act('reprocess').addEventListener('click', async () => {
      try { await window.IRIS.api.vouchervision.reprocess(it.source_id); window.IRIS.toast('Reprocessing…'); refresh(); }
      catch (err) { window.IRIS.toast(err.message, 'error'); }
    });
    if (act('move')) act('move').addEventListener('click', () => moveItem(it));
    if (act('delete')) act('delete').addEventListener('click', async () => {
      if (!confirm('Delete this item? Images, OCR, and extraction are removed.')) return;
      try { await window.IRIS.api.sources.delete(it.source_id); window.IRIS.toast('Deleted.'); closeDrawer(); refresh(); }
      catch (err) { window.IRIS.toast(err.message, 'error'); }
    });
  }

  async function moveItem(it) {
    const others = window.IRIS.session.getProjects().filter(p => p.id !== state.projectId);
    if (!others.length) { window.IRIS.toast('No other project to move to.', 'error'); return; }
    const names = others.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
    const pick = prompt(`Move "${itemTitle(it)}" to which project?\n(tags will not carry over)\n\n${names}\n\nEnter a number:`);
    const idx = Number(pick) - 1;
    if (!(idx >= 0 && idx < others.length)) return;
    try {
      await window.IRIS.api.sources.move(it.source_id, others[idx].id);
      window.IRIS.toast(`Moved to "${others[idx].name}".`);
      closeDrawer(); refresh();
    } catch (err) { window.IRIS.toast(err.message, 'error'); }
  }

  // --- drag & drop (module-scope, gated on the Library being mounted) -------
  let dragDepth = 0;
  const drop = () => document.getElementById('drop-overlay');
  const isActive = () => !!document.getElementById('library-root') && can('upload');
  window.addEventListener('dragenter', e => {
    if (!isActive() || !e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
    dragDepth++; if (drop()) drop().classList.add('show');
  });
  window.addEventListener('dragover', e => { if (isActive()) e.preventDefault(); });
  window.addEventListener('dragleave', () => { if (!isActive()) return; dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0 && drop()) drop().classList.remove('show'); });
  window.addEventListener('drop', async e => {
    if (!isActive()) return;
    e.preventDefault(); dragDepth = 0; if (drop()) drop().classList.remove('show');
    const typeEl = document.getElementById('upload-type');
    await uploadFiles(Array.from(e.dataTransfer.files || []), typeEl ? typeEl.value : 'image');
  });

  // --- entry ---------------------------------------------------------------
  async function mount(container) {
    state.container = container;
    const active = window.IRIS.session.getCurrentProject();
    if (!active) {
      window.IRIS.ProjectPage.noProjectPlaceholder(container, {
        title: 'Library', subtitle: 'specimen images, notebooks, and reference PDFs',
      });
      return;
    }
    if (state.projectId !== active.id) {
      state.projectId = active.id;
      state.items = []; state.tags = [];
      state.selected = new Set(); state.detailId = null;
      state.filters = { type: 'all', status: 'all', search: '', tagIds: new Set() };
      state.role = null;
    }
    await loadRole();
    renderShell(container);
    document.getElementById('library-body').innerHTML = '<div class="empty-list">Loading…</div>';
    await loadAll();
    renderFacets();
    renderBody();
    schedulePoll();
  }

  window.IRIS = window.IRIS || {};
  window.IRIS.SourcesPage = { mount };
})();
