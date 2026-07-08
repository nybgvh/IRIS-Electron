/*
 * References tab.
 *
 * Sources IRIS pulled from external web services, shown as row items. Today
 * that's GBIF occurrences imported from the GBIF tab (project_sources_gbif);
 * later, other project_sources_* tables (natural-heritage libraries, BHL, …)
 * render alongside them here.
 *
 * Each row leads with the SOURCE, then the id, the URL, and the full citation —
 * the reference a curator copies into a publication.
 */

(function () {
  const state = { container: null, projectId: null, rows: [] };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[c]));
  }
  function fmtDate(s) { return s ? String(s).replace('T', ' ').replace(/\.\d+Z?$/, '').replace('Z', ' UTC') : '—'; }

  async function load() {
    try {
      state.rows = await window.IRIS.api.gbif.list(state.projectId);
    } catch (err) {
      state.rows = [];
      window.IRIS.toast(`Could not load references: ${err.message}`, 'error');
    }
  }

  function render() {
    const c = state.container;
    if (!c) return;
    const active = window.IRIS.session.getCurrentProject();
    const rows = state.rows;

    c.innerHTML = `
      <div class="page-toolbar ref-toolbar">
        ${window.IRIS.pageHeader({
          label: 'References',
          name: active ? active.name : 'No project',
          meta: rows.length ? `${rows.length} external source${rows.length === 1 ? '' : 's'}` : 'External sources',
        })}
        <div class="spacer"></div>
        <button class="btn ghost sm" id="ref-refresh">Refresh</button>
        <div class="split-btn" id="ref-export">
          <button class="btn ghost sm split-main" id="ref-export-main" title="Download all citations as plain text">⤓ Export</button>
          <button class="btn ghost sm split-caret" id="ref-export-toggle" title="Export options" aria-label="Export options">▾</button>
          <div class="split-menu" id="ref-export-menu" hidden>
            <div class="split-menu-item" data-export="txt"><span class="bm-label">Citations — plain text (.txt)</span></div>
            <div class="split-menu-item" data-export="ris"><span class="bm-label">Reference manager (.ris)</span></div>
            <div class="split-menu-item" data-export="csv"><span class="bm-label">Full table — all fields (.csv)</span></div>
          </div>
        </div>
      </div>
      <div class="page-body">
        ${rows.length === 0 ? `
          <div class="page-empty">
            <div class="glyph">§</div>
            <h2>No references yet</h2>
            <p>Open the <strong>GBIF</strong> tab, find a specimen, and click
              <em>Add to Library</em>. Each imported occurrence — image, id, URL and
              citation — is recorded here.</p>
          </div>` : `
          <div class="ref-list">
            ${rows.map(renderRow).join('')}
          </div>`}
      </div>`;

    const rf = c.querySelector('#ref-refresh');
    if (rf) rf.addEventListener('click', async () => { await load(); render(); });
    wire();
  }

  function renderRow(r) {
    const thumb = r.source_id ? `iris-source://source/${r.source_id}` : null;
    return `
      <div class="ref-row" data-id="${r.id}">
        <div class="ref-thumb">
          ${thumb ? `<img src="${thumb}" alt="" loading="lazy"/>` : '<span>§</span>'}
        </div>
        <div class="ref-main">
          <div class="ref-line1">
            <span class="ref-badge">GBIF</span>
            <span class="ref-id mono">GBIF ID ${esc(r.gbif_id)}</span>
            ${r.scientific_name ? `<span class="ref-sci">${esc(r.scientific_name)}</span>` : ''}
            ${r.country ? `<span class="ref-meta">· ${esc(r.country)}</span>` : ''}
          </div>
          ${r.occurrence_url ? `<div class="ref-url">
            <a href="${esc(r.occurrence_url)}" target="_blank" rel="noopener noreferrer" class="ref-link">${esc(r.occurrence_url)}</a>
          </div>` : ''}
          <div class="ref-citation">${esc(r.citation || '—')}</div>
          <div class="ref-sub mono small">
            imported ${esc(fmtDate(r.created_at))}
            ${r.dataset_doi ? ` · dataset ${esc(r.dataset_doi)}` : ''}
            ${r.image_url ? ` · <a href="${esc(r.image_url)}" target="_blank" rel="noopener noreferrer" class="ref-link">image source</a>` : ''}
          </div>
        </div>
        <div class="ref-actions">
          <button class="btn ghost sm" data-copy="${r.id}">Copy citation</button>
          ${r.source_id ? `<button class="btn ghost sm" data-view="${r.source_id}">View image</button>` : ''}
          <button class="btn danger sm" data-del="${r.id}">Remove</button>
        </div>
      </div>`;
  }

  // --- export -------------------------------------------------------------
  function projectSlug() {
    const active = window.IRIS.session.getCurrentProject();
    return (active && active.name || 'references').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'references';
  }

  function downloadFile(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  // Plain text — one citation per line.
  function exportTxt() {
    if (!state.rows.length) return window.IRIS.toast('No references to export.', 'error');
    const txt = state.rows.map(r => (r.citation || r.occurrence_url || `GBIF ${r.gbif_id}`).replace(/\s*\n\s*/g, ' ')).join('\n');
    downloadFile(`${projectSlug()}-citations.txt`, txt);
    window.IRIS.toast(`Exported ${state.rows.length} citation(s).`);
  }

  // RIS — the interchange format reference managers (Zotero/EndNote/Mendeley) import.
  function risRecord(r) {
    const clean = (v) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim();
    const year = (String(r.citation || '').match(/\((\d{4})\)/) || [])[1] || String(r.created_at || '').slice(0, 4);
    const L = ['TY  - DATA'];
    if (r.scientific_name) L.push(`TI  - ${clean(r.scientific_name)}`);
    if (r.dataset_title) L.push(`T2  - ${clean(r.dataset_title)}`);
    if (year) L.push(`PY  - ${year}`);
    if (r.dataset_doi) L.push(`DO  - ${clean(r.dataset_doi)}`);
    if (r.occurrence_url) L.push(`UR  - ${clean(r.occurrence_url)}`);
    if (r.country) L.push(`AD  - ${clean(r.country)}`);
    L.push('DP  - GBIF.org');
    L.push(`AN  - ${clean(r.gbif_id)}`);
    if (r.citation) L.push(`N1  - ${clean(r.citation)}`);
    L.push('ER  - ');
    return L.join('\r\n');
  }
  function exportRis() {
    if (!state.rows.length) return window.IRIS.toast('No references to export.', 'error');
    const ris = state.rows.map(risRecord).join('\r\n\r\n') + '\r\n';
    downloadFile(`${projectSlug()}-references.ris`, ris, 'application/x-research-info-systems');
    window.IRIS.toast(`Exported ${state.rows.length} reference(s) as RIS.`);
  }

  // CSV — reference fields + the linked specimen's formatted_json flattened to columns.
  function csvCell(v) {
    if (v == null) return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  async function exportCsv() {
    if (!state.rows.length) return window.IRIS.toast('No references to export.', 'error');
    // Pull the Library items so each reference can carry its extracted fields.
    const byId = new Map();
    try {
      const items = await window.IRIS.api.items.list(state.projectId, {});
      for (const it of items) byId.set(it.source_id, it);
    } catch (_) { /* export still works, just without formatted fields */ }

    // Union of all formatted_json keys across the referenced specimens → columns.
    const fjKeys = new Set();
    for (const r of state.rows) {
      const f = (byId.get(r.source_id) || {}).formatted;
      if (f && typeof f === 'object') for (const k of Object.keys(f)) fjKeys.add(k);
    }
    const fjCols = [...fjKeys];
    const base = ['source', 'gbif_id', 'citation', 'scientific_name', 'occurrence_url', 'image_url',
      'dataset_title', 'dataset_doi', 'catalog_number', 'country', 'latitude', 'longitude', 'imported_at', 'ocr_text'];
    const header = [...base, ...fjCols.map(k => `fj_${k}`)];
    const lines = [header.map(csvCell).join(',')];
    for (const r of state.rows) {
      const it = byId.get(r.source_id) || {};
      const f = (it.formatted && typeof it.formatted === 'object') ? it.formatted : {};
      const row = [
        'GBIF', r.gbif_id, r.citation, r.scientific_name, r.occurrence_url, r.image_url,
        r.dataset_title, r.dataset_doi, r.catalog_number, r.country, r.latitude, r.longitude, r.created_at, it.ocr_text,
        ...fjCols.map(k => f[k]),
      ];
      lines.push(row.map(csvCell).join(','));
    }
    // BOM so Excel reads UTF-8 correctly.
    downloadFile(`${projectSlug()}-references.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    window.IRIS.toast(`Exported ${state.rows.length} reference(s) as CSV.`);
  }

  function toggleExportMenu(open) {
    const menu = state.container && state.container.querySelector('#ref-export-menu');
    if (!menu) return;
    const next = open == null ? menu.hidden : open;
    menu.hidden = !next;
    if (next) document.addEventListener('mousedown', onExportDocClick);
    else document.removeEventListener('mousedown', onExportDocClick);
  }
  function onExportDocClick(e) {
    const split = state.container && state.container.querySelector('#ref-export');
    if (split && split.contains(e.target)) return;
    toggleExportMenu(false);
  }

  function wire() {
    const c = state.container;

    // Split export button: main = txt, caret = menu of all three formats.
    const exportMain = c.querySelector('#ref-export-main');
    if (exportMain) exportMain.addEventListener('click', exportTxt);
    const exportToggle = c.querySelector('#ref-export-toggle');
    if (exportToggle) exportToggle.addEventListener('click', () => toggleExportMenu());
    c.querySelectorAll('#ref-export-menu [data-export]').forEach(el => el.addEventListener('click', () => {
      toggleExportMenu(false);
      const kind = el.dataset.export;
      if (kind === 'txt') exportTxt();
      else if (kind === 'ris') exportRis();
      else if (kind === 'csv') exportCsv();
    }));

    c.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
      const row = state.rows.find(r => r.id === Number(b.dataset.copy));
      if (!row) return;
      try { await navigator.clipboard.writeText(row.citation || ''); window.IRIS.toast('Citation copied.'); }
      catch (_) { window.IRIS.toast('Could not copy.', 'error'); }
    }));
    c.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
      const sid = Number(b.dataset.view);
      window.IRIS.Lightbox.open({
        images: [{ key: 'original', label: 'Original', src: `iris-source://source/${sid}` }],
        activeKey: 'original', title: 'GBIF specimen',
      });
    }));
    c.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      const row = state.rows.find(r => r.id === Number(b.dataset.del));
      if (!row) return;
      if (!confirm(`Remove the GBIF ${row.gbif_id} reference? The imported image stays in the Library.`)) return;
      try {
        await window.IRIS.api.gbif.remove(row.id);
        await load();
        render();
        window.IRIS.toast('Reference removed.');
      } catch (err) { window.IRIS.toast(err.message, 'error'); }
    }));
  }

  async function mount(container) {
    state.container = container;
    const active = window.IRIS.session.getCurrentProject();
    if (!active) {
      window.IRIS.ProjectPage.noProjectPlaceholder(container, {
        title: 'References', subtitle: 'external sources imported into a project',
      });
      return;
    }
    state.projectId = active.id;
    container.innerHTML = '<div class="page-body"><div class="empty-list">Loading…</div></div>';
    await load();
    render();
  }

  window.IRIS = window.IRIS || {};
  window.IRIS.ReferencesPage = { mount };
})();
