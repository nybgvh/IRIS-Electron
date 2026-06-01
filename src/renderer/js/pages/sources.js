/*
 * Sources tab.
 *
 * Ported from the IRIS_ideas.html prototype, retargeted to the IRIS API
 * client (window.IRIS.api.sources.*) instead of the Flask /api/images
 * endpoint, and to the iris-source:// custom protocol for the viewer.
 *
 * Source-type vocabulary:
 *   - 'image'    — specimen photographs
 *   - 'notebook' — field notebooks (PDF underneath, distinct UX category)
 *   - 'pdf'      — books, papers, manuals
 */

(function () {
  // -------------------------------------------------------------------------
  // module-level state — survives tab switches because the router only
  // re-mounts the panel container, not the page module.
  //
  // projectId comes from session.getCurrentProject(). When the user switches
  // projects via the topbar switcher or Project tab, we wipe per-project
  // state (selected item, expanded set, zoom) and re-fetch sources.
  // -------------------------------------------------------------------------
  const state = {
    container: null,
    projectId: null,
    items: [],
    selectedId: null,
    expanded: new Set(),
    sourceFilter: 'all',
    zoom: 1,
  };

  const SOURCE_LABEL = {
    image:    'Specimens',
    notebook: 'Field Notebooks',
    pdf:      'PDFs',
  };
  const SOURCE_GLYPH = {
    image:    '🌿',
    notebook: '📓',
    pdf:      '📄',
  };
  const UPLOAD_OPTIONS = [
    { value: 'image',    label: 'Specimen Image' },
    { value: 'notebook', label: 'Field Notebook' },
    { value: 'pdf',      label: 'PDF / Book / Manual' },
  ];

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------
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
    return `<span class="specimen-badge iucn-empty">UNASSESSED</span>`;
  }

  function typeLabel(type) {
    return {
      image:    ['type-image',    'SPECIMEN'],
      notebook: ['type-notebook', 'NOTEBOOK'],
      pdf:      ['type-pdf',      'PDF'],
    }[type] || ['iucn-empty', 'SOURCE'];
  }

  // -------------------------------------------------------------------------
  // network
  // -------------------------------------------------------------------------
  async function loadItems() {
    if (!state.projectId) { state.items = []; renderList(); renderViewer(); return; }
    try {
      state.items = await window.IRIS.api.sources.list(state.projectId, {});
    } catch (err) {
      state.items = [];
      window.IRIS.toast(`Could not load sources: ${err.message}`, 'error');
    }
    renderList();
    if (state.selectedId && !state.items.find(i => i.id === state.selectedId)) {
      state.selectedId = null;
      renderViewer();
    }
  }

  async function uploadFiles(files, sourceType) {
    if (!files || !files.length) return;
    if (!state.projectId) {
      window.IRIS.toast('Select a project first.', 'error');
      return;
    }
    const pid = state.projectId;
    for (const f of files) {
      try {
        const buf = await f.arrayBuffer();
        const created = await window.IRIS.api.sources.upload(pid, {
          filename: f.name,
          mime_type: f.type || 'application/octet-stream',
          buffer: buf,
          source_type: sourceType,
        });
        window.IRIS.toast(`Uploaded ${created.filename}`);
      } catch (err) {
        window.IRIS.toast(`Upload failed: ${f.name} — ${err.message}`, 'error');
      }
    }
    loadItems();
  }

  async function deleteSource(id) {
    if (!confirm('Delete this source?')) return;
    try {
      await window.IRIS.api.sources.delete(id);
      window.IRIS.toast('Source deleted.');
      if (state.selectedId === id) { state.selectedId = null; }
      state.expanded.delete(id);
      loadItems();
    } catch (err) {
      window.IRIS.toast(`Delete failed: ${err.message}`, 'error');
    }
  }

  // -------------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------------
  function renderShell(container) {
    const active = window.IRIS.session.getCurrentProject();
    container.innerHTML = `
      <div class="page-toolbar">
        <span class="title">Sources</span>
        <span class="subtitle">— ${active ? `in <em>${escapeHtml(active.name)}</em>` : 'no project selected'}</span>
        <div class="spacer"></div>

        <div class="source-filter-chips" id="source-filter">
          <button class="chip ${state.sourceFilter === 'all'      ? 'active' : ''}" data-filter="all">All</button>
          <button class="chip ${state.sourceFilter === 'image'    ? 'active' : ''}" data-filter="image">Specimens</button>
          <button class="chip ${state.sourceFilter === 'notebook' ? 'active' : ''}" data-filter="notebook">Field Notebooks</button>
          <button class="chip ${state.sourceFilter === 'pdf'      ? 'active' : ''}" data-filter="pdf">PDFs</button>
        </div>

        <input type="file" id="file-input" accept="image/*,application/pdf" multiple hidden />
        <button class="btn ghost sm" id="refresh-btn">Refresh</button>
        <select class="select" id="upload-type" style="width: auto; min-width: 170px;">
          ${UPLOAD_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
        </select>
        <button class="btn sm" id="upload-btn">Upload</button>
      </div>

      <div class="sources-grid">
        <aside class="specimen-list" id="specimen-list">
          <div class="specimen-list-header">
            <input type="text" class="specimen-search" id="search-input" placeholder="Search name, locality, file…" />
            <div class="specimen-count" id="specimen-count">0 SOURCES</div>
          </div>
          <div id="specimen-items"></div>
        </aside>

        <div class="image-viewer">
          <div class="viewer-toolbar">
            <span class="scientific" id="viewer-name">No source selected</span>
            <span class="filename" id="viewer-file"></span>
            <div class="spacer"></div>
            <div class="viewer-zoom">
              <button class="zoom-btn" id="zoom-out" title="Zoom out">−</button>
              <span class="zoom-label" id="zoom-label">100%</span>
              <button class="zoom-btn" id="zoom-in" title="Zoom in">+</button>
              <button class="zoom-btn" id="zoom-fit" title="Fit">⤢</button>
            </div>
          </div>
          <div class="viewer-canvas" id="viewer-canvas"></div>
        </div>
      </div>
    `;

    // ----- filter chips
    container.querySelectorAll('#source-filter .chip').forEach(c => {
      c.addEventListener('click', () => {
        container.querySelectorAll('#source-filter .chip').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
        state.sourceFilter = c.dataset.filter;
        renderList();
      });
    });

    // ----- search
    container.querySelector('#search-input').addEventListener('input', renderList);

    // ----- refresh
    container.querySelector('#refresh-btn').addEventListener('click', loadItems);

    // ----- upload
    const fileInput = container.querySelector('#file-input');
    container.querySelector('#upload-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files || []);
      const type = container.querySelector('#upload-type').value;
      await uploadFiles(files, type);
      fileInput.value = '';
    });

    // ----- zoom
    container.querySelector('#zoom-in').addEventListener('click',  () => { state.zoom = Math.min(8, state.zoom * 1.25); applyZoom(); });
    container.querySelector('#zoom-out').addEventListener('click', () => { state.zoom = Math.max(0.1, state.zoom / 1.25); applyZoom(); });
    container.querySelector('#zoom-fit').addEventListener('click', () => { state.zoom = 1; applyZoom(); });
  }

  function visibleItems() {
    const term = (document.getElementById('search-input').value || '').toLowerCase().trim();
    return state.items.filter(item => {
      if (state.sourceFilter !== 'all' && item.source_type !== state.sourceFilter) return false;
      if (!term) return true;
      const m = item.metadata || {};
      const haystack = [
        item.filename, m.scientific_name, m.common_name, m.specimen_id,
        m.title, m.authors, m.locality, m.country, (m.iucn || {}).category,
        m.collector, m.expedition,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(term);
    });
  }

  function renderList() {
    const itemsEl = document.getElementById('specimen-items');
    const countEl = document.getElementById('specimen-count');
    if (!itemsEl || !countEl) return;
    const list = visibleItems();
    countEl.textContent = `${list.length} SOURCE${list.length === 1 ? '' : 'S'}`;

    if (list.length === 0) {
      itemsEl.innerHTML = `<div class="empty-list">
        ${state.items.length === 0
          ? '“In every walk with nature, one receives far more than he seeks.”<br/>— upload a source to begin.'
          : 'No matches.'}
      </div>`;
      return;
    }

    itemsEl.innerHTML = list.map(item => {
      const m = item.metadata || {};
      const expanded = state.expanded.has(item.id);
      const selected = state.selectedId === item.id;
      const type = item.source_type || 'image';
      const [tcls, tlabel] = typeLabel(type);

      let title, subtitle;
      if (type === 'pdf') {
        title = m.title || item.filename;
        subtitle = [m.authors, m.year].filter(Boolean).join(' · ') || 'PDF source';
      } else if (type === 'notebook') {
        title = m.collector ? `${m.collector} — Notebook` : (m.expedition || item.filename);
        subtitle = [m.date_range, m.expedition].filter(Boolean).join(' · ') || 'Field notebook';
      } else {
        title = m.scientific_name || item.filename;
        subtitle = [m.locality, m.country].filter(Boolean).join(', ') || m.specimen_id || item.filename;
      }

      const cat = (m.iucn && m.iucn.category) || null;
      const isImg = (item.mime_type || '').startsWith('image/');
      const thumbStyle = isImg ? `background-image:url('iris-source://source/${item.id}')` : '';
      const thumbInner = isImg ? '' : (SOURCE_GLYPH[type] || '◆');

      return `
        <div class="specimen-item ${expanded ? 'expanded' : ''} ${selected ? 'selected' : ''}" data-id="${item.id}">
          <div class="specimen-summary" data-action="toggle">
            <div class="specimen-thumb" style="${thumbStyle}">${thumbInner}</div>
            <div class="specimen-info">
              <div class="specimen-name">${escapeHtml(title)}</div>
              <div class="specimen-meta">${escapeHtml(subtitle)}</div>
              <div class="row-badges">
                <span class="specimen-badge ${tcls}">${tlabel}</span>
                ${type === 'image' ? iucnBadge(cat) : ''}
              </div>
            </div>
            <span class="specimen-caret">▶</span>
          </div>
          <div class="specimen-details">
            <div class="json-viewer">${syntaxJSON(item.metadata)}</div>
            <div class="specimen-detail-actions">
              <button class="btn ghost sm" data-action="view">View</button>
              <button class="btn ghost sm" data-action="copy">Copy JSON</button>
              <button class="btn danger sm" data-action="delete">Delete</button>
            </div>
          </div>
        </div>`;
    }).join('');

    itemsEl.querySelectorAll('.specimen-item').forEach(el => {
      const id = Number(el.dataset.id);
      el.querySelector('[data-action="toggle"]').addEventListener('click', () => {
        if (state.expanded.has(id)) state.expanded.delete(id);
        else state.expanded.add(id);
        selectItem(id);
      });
      el.querySelector('[data-action="view"]').addEventListener('click', e => {
        e.stopPropagation(); selectItem(id);
      });
      el.querySelector('[data-action="copy"]').addEventListener('click', e => {
        e.stopPropagation();
        const item = state.items.find(i => i.id === id);
        navigator.clipboard.writeText(JSON.stringify(item.metadata || {}, null, 2))
          .then(() => window.IRIS.toast('Metadata JSON copied.'));
      });
      el.querySelector('[data-action="delete"]').addEventListener('click', e => {
        e.stopPropagation();
        deleteSource(id);
      });
    });
  }

  function selectItem(id) {
    state.selectedId = id;
    state.zoom = 1;
    renderViewer();
    renderList();
  }

  function renderViewer() {
    const nameEl = document.getElementById('viewer-name');
    const fileEl = document.getElementById('viewer-file');
    const canvas = document.getElementById('viewer-canvas');
    if (!nameEl || !fileEl || !canvas) return;

    if (!state.selectedId) {
      nameEl.textContent = 'No source selected';
      fileEl.textContent = '';
      canvas.innerHTML = `
        <div class="viewer-empty">
          <div class="glyph">✿</div>
          Select a source on the left to view it, or upload a specimen image,
          field notebook, or PDF to begin.
        </div>`;
      return;
    }

    const item = state.items.find(i => i.id === state.selectedId);
    if (!item) { state.selectedId = null; renderViewer(); return; }
    const m = item.metadata || {};
    const type = item.source_type || 'image';
    const displayName = type === 'pdf'      ? (m.title || item.filename)
                      : type === 'notebook' ? (m.collector ? `${m.collector} — Notebook` : item.filename)
                                            : (m.scientific_name || item.filename);
    nameEl.textContent = displayName;
    fileEl.textContent = item.filename;

    const src = `iris-source://source/${item.id}`;
    if ((item.mime_type || '').startsWith('image/')) {
      canvas.innerHTML = `<img id="viewer-img" src="${src}" alt="${escapeHtml(item.filename)}" />`;
      applyZoom();
    } else if ((item.mime_type || '') === 'application/pdf') {
      canvas.innerHTML = `<embed src="${src}" type="application/pdf"
        style="width:100%; height:100%; min-height:60vh; background:white;" />`;
    } else {
      canvas.innerHTML = `<div class="pdf-preview">
        <h3>${escapeHtml(item.filename)}</h3>
        <p>This source is not previewable inline.</p>
      </div>`;
    }
  }

  function applyZoom() {
    const img = document.getElementById('viewer-img');
    if (img) img.style.transform = `scale(${state.zoom})`;
    const lbl = document.getElementById('zoom-label');
    if (lbl) lbl.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  // -------------------------------------------------------------------------
  // drag-and-drop — wire once at module load, gated on whether the Sources
  // tab is mounted (we check for the existence of #upload-type).
  // -------------------------------------------------------------------------
  let dragDepth = 0;
  const drop = () => document.getElementById('drop-overlay');
  const isActive = () => !!document.getElementById('upload-type');

  window.addEventListener('dragenter', e => {
    if (!isActive()) return;
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
    dragDepth++;
    drop().classList.add('show');
  });
  window.addEventListener('dragover', e => { if (isActive()) e.preventDefault(); });
  window.addEventListener('dragleave', () => {
    if (!isActive()) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) drop().classList.remove('show');
  });
  window.addEventListener('drop', async e => {
    if (!isActive()) return;
    e.preventDefault();
    dragDepth = 0;
    drop().classList.remove('show');
    const files = Array.from(e.dataTransfer.files || []);
    const sourceType = document.getElementById('upload-type').value;
    await uploadFiles(files, sourceType);
  });

  // -------------------------------------------------------------------------
  // entry
  //
  // We deliberately do NOT subscribe to session.onProjectChange here.
  // The router owns the single project-change subscription (see router.js)
  // and calls SourcesPage.mount(#app-main) whenever the active tab is
  // Sources at the moment the project changes. Subscribing from every page
  // module led to multiple page renderers fighting over #app-main and
  // briefly showing the wrong tab's content.
  // -------------------------------------------------------------------------
  function mount(container) {
    state.container = container;
    const active = window.IRIS.session.getCurrentProject();
    if (!active) {
      // No project context — show a directive empty state instead of the
      // upload/list UI. The upload feature only lives inside a project.
      window.IRIS.ProjectPage.noProjectPlaceholder(container, {
        title: 'Sources',
        subtitle: 'specimen images, field notebooks, and reference PDFs',
      });
      return;
    }
    if (state.projectId !== active.id) {
      // Active project changed since last mount; reset per-project state.
      state.projectId = active.id;
      state.items = [];
      state.selectedId = null;
      state.expanded = new Set();
    }
    renderShell(container);
    renderViewer();
    loadItems();
  }

  window.IRIS = window.IRIS || {};
  window.IRIS.SourcesPage = { mount };
})();
