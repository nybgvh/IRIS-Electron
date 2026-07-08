/*
 * Assessment tab — master/detail.
 *
 * LEFT RAIL: every assessment in the project (each is a versioned "series"),
 * plus a "+ New assessment" action. RIGHT PANE: either the selected
 * assessment (reading view + version switcher + curate controls) or the
 * BUILDER for starting a new one.
 *
 * The builder is how a curator scopes a run. A project draws on many sources,
 * so you can pick a group by:
 *   - a quick scope: all complete items, all of one type (specimen / notebook /
 *     PDF), or everything sharing a tag
 *   - hand-picked checkboxes in a compact, library-style item list
 * The chosen set is sent to the model, which returns the six RETURN_SCHEMA
 * sections. Rerunning appends a new version in the same series.
 */

(function () {
  const SECTION_ORDER = [
    'Taxonomy', 'Geographic_Range', 'Habitat', 'Ecology',
    'Use_and_Trade', 'Threats_and_Conservation_Actions',
  ];
  const IUCN_CATEGORIES = ['', 'EX','EW','CR','EN','VU','NT','LC','DD','NE'];
  const STATUSES = ['draft', 'review', 'final'];
  const ORIGIN_GLYPH = { specimen: '🌿', notebook: '📓', pdf: '📄' };
  const ORIGIN_LABEL = { specimen: 'Specimen', notebook: 'Notebook', pdf: 'PDF' };
  const ORIGIN_PLURAL = { specimen: 'specimens', notebook: 'field notebooks', pdf: 'PDFs' };

  const state = {
    container: null,
    projectId: null,
    runs: [],            // all assessment rows for the project
    items: [],           // all project items (builder + citation resolution)
    tags: [],            // project tags
    view: 'detail',      // 'detail' | 'builder'
    activeSeriesId: null,// series shown in the reading pane
    renaming: null,      // series_id currently being renamed inline (or null)
    selectedVersion: {}, // series_id → chosen run id to display
    builder: { selected: new Set(), search: '', label: '', scope: null },
    busy: false,
    itemsById: new Map(),// source_id → item (citation hovercards + builder)
    tagMap: new Map(),   // citation key (catalogNumber / filename) → item
    canFlag: false,
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
    }[c]));
  }
  function fmtDate(s) { return s ? String(s).replace('T', ' ').replace(/\.\d+Z?$/, '').replace('Z', ' UTC') : '—'; }
  function prettyKey(k) { return k.replace(/_/g, ' '); }

  // Upload origin of an item (mirrors the Library): 'specimen' | 'notebook' | 'pdf'.
  function itemOrigin(it) {
    const o = it && it.metadata && it.metadata.origin;
    return (o === 'pdf' || o === 'notebook') ? o : 'specimen';
  }
  function isComplete(it) { return (it.vv_status || 'none') === 'complete'; }
  function thumbUrl(it) {
    if (it.has_cropped_image && it.vv_id) return `iris-source://vv/${it.vv_id}/cropped`;
    if (it.has_full_image && it.vv_id) return `iris-source://vv/${it.vv_id}/full`;
    if ((it.mime_type || '').startsWith('image/')) return `iris-source://source/${it.source_id}`;
    return null;
  }
  function itemTitle(it) {
    return it.scientific_name || (it.metadata && it.metadata.scientific_name) || it.filename || `Item ${it.source_id}`;
  }

  // --- data ----------------------------------------------------------------
  async function load() {
    try {
      state.runs = await window.IRIS.api.assessments.list(state.projectId);
    } catch (err) {
      state.runs = [];
      window.IRIS.toast(`Could not load assessments: ${err.message}`, 'error');
    }
    await loadItems();
    // Default the reading pane to the newest series if nothing valid is active.
    const groups = series();
    if (!state.activeSeriesId || !groups.some(g => g.seriesId === state.activeSeriesId)) {
      state.activeSeriesId = groups.length ? groups[0].seriesId : null;
    }
  }

  // Load project items for the builder AND so inline citations (#{tag}) resolve
  // to a specimen for hover previews. Keys: catalog number + filename (± ext).
  async function loadItems() {
    state.itemsById = new Map();
    state.tagMap = new Map();
    try {
      const [items, tags] = await Promise.all([
        window.IRIS.api.items.list(state.projectId, {}),
        window.IRIS.api.tags.list(state.projectId).catch(() => []),
      ]);
      state.items = items;
      state.tags = tags;
      for (const it of items) {
        state.itemsById.set(it.source_id, it);
        const cn = it.formatted && (it.formatted.catalogNumber || it.formatted.catalog_number);
        if (cn) state.tagMap.set(String(cn).toLowerCase().trim(), it);
        if (it.filename) {
          state.tagMap.set(it.filename.toLowerCase(), it);
          state.tagMap.set(it.filename.replace(/\.[^.]+$/, '').toLowerCase(), it);
        }
      }
    } catch (_) { state.items = state.items || []; }
  }

  async function loadRole() {
    const user = window.IRIS.session.get();
    if (user && user.role === 'admin') { state.canFlag = true; return; }
    try {
      const members = await window.IRIS.api.members.list(state.projectId);
      const mine = members.find(m => Number(m.user_id) === Number(user.id));
      state.canFlag = mine ? (mine.role === 'owner' || mine.role === 'editor') : false;
    } catch (_) { state.canFlag = false; }
  }

  const HTML_ESC = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
  function escapeHtmlText(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => HTML_ESC[c]); }
  function unescapeHtml(s) {
    return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }

  // Escape a section, then turn #{tag} tokens into specimen links (underlined).
  function linkifySection(text) {
    const escd = escapeHtmlText(text);
    const linked = escd.replace(/#\{([^}]+)\}/g, (_m, keyEsc) => {
      const key = unescapeHtml(keyEsc).toLowerCase().trim();
      const item = state.tagMap.get(key) || state.tagMap.get(key.replace(/\.[^.]+$/, ''));
      if (item) return `<a class="specimen-link" data-sid="${item.source_id}">${keyEsc}</a>`;
      return keyEsc; // unresolved: show the key without the #{} wrapper
    });
    return linked.replace(/\n/g, '<br/>');
  }

  // Group runs into series (by series_id, fallback to own id), newest first.
  function series() {
    const bySeries = new Map();
    for (const r of state.runs) {
      const sid = r.series_id || r.id;
      if (!bySeries.has(sid)) bySeries.set(sid, []);
      bySeries.get(sid).push(r);
    }
    const out = [];
    for (const [sid, runs] of bySeries) {
      runs.sort((a, b) => (b.version || 1) - (a.version || 1));
      out.push({ seriesId: sid, runs, latest: runs[0] });
    }
    out.sort((a, b) => String(b.latest.created_at).localeCompare(String(a.latest.created_at)));
    return out;
  }

  // --- scope selection -----------------------------------------------------
  // Complete, summarizable items only (VVGO must have produced OCR/fields).
  function completeItems() { return state.items.filter(isComplete); }

  // The quick-scope chips available for THIS project (only non-empty ones).
  function scopeOptions() {
    const complete = completeItems();
    const opts = [{ key: 'all', label: 'All complete items', count: complete.length }];
    for (const origin of ['specimen', 'notebook', 'pdf']) {
      const n = complete.filter(it => itemOrigin(it) === origin).length;
      if (n) opts.push({ key: `origin:${origin}`, label: `All ${ORIGIN_PLURAL[origin]}`, count: n });
    }
    for (const t of state.tags) {
      const n = complete.filter(it => (it.tags || []).some(tg => tg.id === t.id)).length;
      if (n) opts.push({ key: `tag:${t.id}`, label: `Tag: ${t.name}`, count: n, color: t.color });
    }
    return opts;
  }

  // Resolve a scope key to the set of complete source ids it selects.
  function idsForScope(key) {
    const complete = completeItems();
    if (key === 'all') return complete.map(it => it.source_id);
    if (key.startsWith('origin:')) {
      const o = key.slice('origin:'.length);
      return complete.filter(it => itemOrigin(it) === o).map(it => it.source_id);
    }
    if (key.startsWith('tag:')) {
      const id = Number(key.slice('tag:'.length));
      return complete.filter(it => (it.tags || []).some(tg => tg.id === id)).map(it => it.source_id);
    }
    return [];
  }

  function applyScope(key) {
    const opt = scopeOptions().find(o => o.key === key);
    state.builder.scope = key;
    state.builder.selected = new Set(idsForScope(key));
    if (opt) state.builder.label = opt.label;
    render();
  }

  function openBuilder(preselectIds) {
    state.view = 'builder';
    state.renaming = null;
    state.builder = { selected: new Set(preselectIds || []), search: '', label: '', scope: null };
    if (preselectIds && preselectIds.length) {
      const complete = new Set(completeItems().map(it => it.source_id));
      // Keep only the ones that can actually be summarized.
      state.builder.selected = new Set(preselectIds.filter(id => complete.has(id)));
      state.builder.label = `${state.builder.selected.size} selected item(s)`;
    }
    render();
  }

  // --- generation ----------------------------------------------------------
  async function generate(opts, labelForToast) {
    if (state.busy) return;
    state.busy = true;
    render();
    window.IRIS.toast(`Generating summary${labelForToast ? ` for ${labelForToast}` : ''}… this can take a while.`);
    try {
      const run = await window.IRIS.api.assessments.generate(state.projectId, opts);
      window.IRIS.pendingSummary = null;
      await load();
      state.view = 'detail';
      state.activeSeriesId = run.series_id || run.id;
      state.selectedVersion[run.series_id || run.id] = run.id;
      window.IRIS.toast('Summary ready.');
    } catch (err) {
      window.IRIS.toast(err.message || 'Generation failed.', 'error');
    } finally {
      state.busy = false;
      render();
    }
  }

  async function generateFromBuilder() {
    const ids = [...state.builder.selected];
    if (!ids.length) { window.IRIS.toast('Select at least one item to summarize.', 'error'); return; }
    const label = (state.builder.label || '').trim() || null;
    await generate({ sourceIds: ids, label }, `${ids.length} item(s)`);
  }

  async function rerun(run) {
    if (!confirm(`Rerun this summary? A new version (v${(run.version || 1) + 1}) is added; the current one is kept.`)) return;
    await generate({ rerunOf: run.id }, run.scientific_name || 'series');
  }

  async function deleteRun(run, group) {
    const only = group.runs.length === 1;
    const msg = only
      ? `Delete "${run.scientific_name || 'summary'}"? This removes the assessment.`
      : `Delete version v${run.version} of "${run.scientific_name || 'summary'}"? Other versions are kept.`;
    if (!confirm(msg)) return;
    try {
      await window.IRIS.api.assessments.delete(run.id);
      // If the shown version was deleted, fall back to the latest remaining.
      if (state.selectedVersion[group.seriesId] === run.id) delete state.selectedVersion[group.seriesId];
      await load();
      window.IRIS.toast(only ? 'Assessment deleted.' : 'Version deleted.');
      render();
    } catch (err) { window.IRIS.toast(err.message, 'error'); }
  }

  async function patchRun(run, patch) {
    try {
      await window.IRIS.api.assessments.update(run.id, patch);
      await load();
      render();
    } catch (err) { window.IRIS.toast(err.message, 'error'); }
  }

  // --- render --------------------------------------------------------------
  function render() {
    const container = state.container;
    if (!container) return;
    const active = window.IRIS.session.getCurrentProject();
    const groups = series();

    container.innerHTML = `
      <div class="page-toolbar">
        ${window.IRIS.pageHeader({
          label: 'Assessment',
          name: active ? active.name : 'Assessment',
          meta: `IUCN Red List${groups.length ? ` · ${groups.length} assessment${groups.length === 1 ? '' : 's'}` : ' draft summaries'}`,
        })}
        <div class="spacer"></div>
        <button class="btn sm" id="new-assess-btn" ${state.busy ? 'disabled' : ''}>+ New assessment</button>
      </div>
      <div class="page-body">
        <div class="assess-layout">
          <aside class="assess-rail">
            ${renderRail(groups)}
          </aside>
          <section class="assess-detail">
            ${state.view === 'builder'
              ? renderBuilder()
              : (groups.length
                  ? renderDetail(groups.find(g => g.seriesId === state.activeSeriesId) || groups[0])
                  : renderEmpty())}
          </section>
        </div>
      </div>
    `;

    const nb = container.querySelector('#new-assess-btn');
    if (nb) nb.addEventListener('click', () => openBuilder([]));
    wireRail(container, groups);
    if (state.view === 'builder') wireBuilder(container);
    else wireDetail(container, groups);
    wireCitations(container);
  }

  function renderEmpty() {
    return `
      <div class="page-empty">
        <div class="glyph">✦</div>
        <h2>No assessments yet</h2>
        <p>Start one with <strong>+ New assessment</strong>: scope it to all complete items,
          a type, a tag, or hand-pick specimens. Each run drafts the six IUCN sections and is
          versioned so you can rerun and refine.</p>
        <button class="btn" id="empty-new-btn">+ New assessment</button>
      </div>`;
  }

  // ---- left rail ----------------------------------------------------------
  function renderRail(groups) {
    const rows = groups.map(g => {
      const latest = g.latest;
      const cat = latest.iucn_category || '';
      const active = state.view === 'detail' && g.seriesId === state.activeSeriesId;
      const rc = latest.payload && latest.payload.record_count;
      return `
        <button class="assess-rail-item ${active ? 'active' : ''}" data-series="${g.seriesId}">
          <div class="rail-line1">
            <span class="rail-name">${escapeHtml(latest.scientific_name || 'Untitled')}</span>
            ${cat ? `<span class="cat-chip cat-${cat}">${cat}</span>` : ''}
          </div>
          <div class="rail-line2">
            <span class="status-dot s-${escapeHtml(latest.status || 'draft')}"></span>${escapeHtml(latest.status || 'draft')}
            ${g.runs.length > 1 ? ` · v${latest.version}` : ''}
            ${rc != null ? ` · ${rc} item${rc === 1 ? '' : 's'}` : ''}
          </div>
        </button>`;
    }).join('');
    return `
      <button class="assess-rail-new ${state.view === 'builder' ? 'active' : ''}" data-newrail>+ New assessment</button>
      <div class="assess-rail-list">
        ${groups.length ? rows : '<div class="muted small rail-empty">No assessments yet.</div>'}
      </div>`;
  }

  function wireRail(container, groups) {
    const nr = container.querySelector('[data-newrail]');
    if (nr) nr.addEventListener('click', () => openBuilder([]));
    const en = container.querySelector('#empty-new-btn');
    if (en) en.addEventListener('click', () => openBuilder([]));
    container.querySelectorAll('.assess-rail-item[data-series]').forEach(b => b.addEventListener('click', () => {
      state.view = 'detail';
      state.activeSeriesId = Number(b.dataset.series);
      state.renaming = null;
      render();
    }));
  }

  // ---- builder ------------------------------------------------------------
  function renderBuilder() {
    const opts = scopeOptions();
    const term = (state.builder.search || '').toLowerCase().trim();
    const selected = state.builder.selected;

    // All items, complete first, filtered by the search term.
    const rows = state.items
      .filter(it => {
        if (!term) return true;
        const hay = [it.filename, it.scientific_name, itemOrigin(it),
          ...(it.tags || []).map(t => t.name)].join(' ').toLowerCase();
        return hay.includes(term);
      })
      .sort((a, b) => (isComplete(b) - isComplete(a)) || String(itemTitle(a)).localeCompare(itemTitle(b)));

    const nComplete = completeItems().length;

    return `
      <div class="assess-builder">
        <div class="builder-head">
          <h3>New assessment</h3>
          <button class="btn ghost sm" data-builder-cancel>Cancel</button>
        </div>

        <div class="builder-scopes">
          <div class="builder-label">Quick scope</div>
          <div class="scope-chips">
            ${opts.length
              ? opts.map(o => `
                <button class="scope-chip ${state.builder.scope === o.key ? 'active' : ''}" data-scope="${escapeHtml(o.key)}"
                  ${o.color ? `style="--chip:${escapeHtml(o.color)}"` : ''}>
                  ${escapeHtml(o.label)}<span class="scope-count">${o.count}</span>
                </button>`).join('')
              : '<span class="muted small">No completed items to summarize yet.</span>'}
          </div>
        </div>

        <div class="builder-listwrap">
          <div class="builder-listbar">
            <div class="builder-label">Items <span class="muted">— pick individually or refine a scope</span></div>
            <div class="spacer"></div>
            <input class="input sm" data-builder-search placeholder="Search items…" value="${escapeHtml(state.builder.search)}" />
            <button class="btn ghost sm" data-select-visible>Select all</button>
            <button class="btn ghost sm" data-select-none>Clear</button>
          </div>
          <div class="builder-list">
            ${rows.length ? rows.map(it => renderBuilderRow(it, selected.has(it.source_id))).join('')
              : '<div class="muted small" style="padding:14px">No items match.</div>'}
          </div>
        </div>

        <div class="builder-footer">
          <div class="builder-count"><strong>${selected.size}</strong> of ${nComplete} selected</div>
          <input class="input" data-builder-label placeholder="Assessment name (optional)" value="${escapeHtml(state.builder.label)}" />
          <button class="btn" data-builder-generate ${state.busy || !selected.size ? 'disabled' : ''}>
            ${state.busy ? 'Generating…' : 'Generate summary'}
          </button>
        </div>
      </div>`;
  }

  function renderBuilderRow(it, checked) {
    const complete = isComplete(it);
    const origin = itemOrigin(it);
    const thumb = thumbUrl(it);
    const statusTxt = complete ? '' : (it.vv_status === 'pending' ? 'processing…'
      : it.vv_status === 'errored' ? 'failed' : 'not processed');
    return `
      <label class="builder-row ${checked ? 'picked' : ''} ${complete ? '' : 'disabled'}">
        <input type="checkbox" data-pick="${it.source_id}" ${checked ? 'checked' : ''} ${complete ? '' : 'disabled'} />
        <div class="builder-thumb">${thumb ? `<img src="${thumb}" alt="" loading="lazy"/>` : `<span>${ORIGIN_GLYPH[origin]}</span>`}</div>
        <div class="builder-rowbody">
          <div class="builder-rowtitle">${escapeHtml(itemTitle(it))}</div>
          <div class="builder-rowsub mono small">
            <span title="${ORIGIN_LABEL[origin]}">${ORIGIN_GLYPH[origin]} ${ORIGIN_LABEL[origin]}</span>
            ${(it.tags || []).length ? ' · ' + it.tags.map(t => `<span class="mini-tag" ${t.color ? `style="--tag:${escapeHtml(t.color)}"` : ''}>${escapeHtml(t.name)}</span>`).join(' ') : ''}
          </div>
        </div>
        ${statusTxt ? `<span class="builder-status">${statusTxt}</span>` : ''}
      </label>`;
  }

  function wireBuilder(container) {
    const cancel = container.querySelector('[data-builder-cancel]');
    if (cancel) cancel.addEventListener('click', () => {
      state.view = 'detail';
      render();
    });
    container.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => applyScope(b.dataset.scope)));

    const search = container.querySelector('[data-builder-search]');
    if (search) search.addEventListener('input', () => {
      state.builder.search = search.value;
      // Re-render just the list to keep focus stable.
      const list = container.querySelector('.builder-list');
      const term = search.value.toLowerCase().trim();
      const rows = state.items
        .filter(it => {
          if (!term) return true;
          const hay = [it.filename, it.scientific_name, itemOrigin(it), ...(it.tags || []).map(t => t.name)].join(' ').toLowerCase();
          return hay.includes(term);
        })
        .sort((a, b) => (isComplete(b) - isComplete(a)) || String(itemTitle(a)).localeCompare(itemTitle(b)));
      if (list) {
        list.innerHTML = rows.length ? rows.map(it => renderBuilderRow(it, state.builder.selected.has(it.source_id))).join('')
          : '<div class="muted small" style="padding:14px">No items match.</div>';
        wirePicks(container);
      }
    });

    container.querySelectorAll('[data-select-visible]').forEach(b => b.addEventListener('click', () => {
      // Select all currently-visible complete rows (respects the search filter).
      container.querySelectorAll('.builder-list [data-pick]:not([disabled])').forEach(cb => {
        state.builder.selected.add(Number(cb.dataset.pick));
      });
      state.builder.scope = null;
      render();
    }));
    container.querySelectorAll('[data-select-none]').forEach(b => b.addEventListener('click', () => {
      state.builder.selected.clear();
      state.builder.scope = null;
      render();
    }));

    const label = container.querySelector('[data-builder-label]');
    if (label) label.addEventListener('input', () => { state.builder.label = label.value; });

    const gen = container.querySelector('[data-builder-generate]');
    if (gen) gen.addEventListener('click', generateFromBuilder);

    wirePicks(container);
  }

  // Checkbox toggles update the count + footer without a full re-render (keeps
  // the list scroll position). Picking anything clears the active quick-scope.
  function wirePicks(container) {
    container.querySelectorAll('.builder-list [data-pick]').forEach(cb => cb.addEventListener('change', () => {
      const sid = Number(cb.dataset.pick);
      if (cb.checked) state.builder.selected.add(sid); else state.builder.selected.delete(sid);
      state.builder.scope = null;
      cb.closest('.builder-row').classList.toggle('picked', cb.checked);
      const count = container.querySelector('.builder-count');
      if (count) count.innerHTML = `<strong>${state.builder.selected.size}</strong> of ${completeItems().length} selected`;
      const gen = container.querySelector('[data-builder-generate]');
      if (gen) gen.disabled = state.busy || !state.builder.selected.size;
      container.querySelectorAll('.scope-chip.active').forEach(c => c.classList.remove('active'));
    }));
  }

  // ---- detail (reading pane) ----------------------------------------------
  function renderDetail(g) {
    if (!g) return renderEmpty();
    const selId = state.selectedVersion[g.seriesId] || g.latest.id;
    const run = g.runs.find(r => r.id === selId) || g.latest;
    const sections = (run.payload && run.payload.sections) || {};
    const rc = run.payload && run.payload.record_count;
    const taxa = (run.payload && run.payload.taxa) || [];
    // Versions ascending for a natural left→right timeline.
    const versionsAsc = [...g.runs].sort((a, b) => (a.version || 1) - (b.version || 1));

    return `
      <div class="assess-doc" data-series="${g.seriesId}">
        <div class="assess-doc-head">
          <div class="assess-title-col">
            ${state.renaming === g.seriesId
              ? `<div class="assess-rename-row">
                   <input class="input assess-name-input" data-rename-input value="${escapeHtml(run.scientific_name || '')}" placeholder="Assessment name" />
                   <button class="btn sm" data-rename-save>Save</button>
                   <button class="btn ghost sm" data-rename-cancel>Cancel</button>
                 </div>`
              : `<div class="assess-title-line">
                   <h3 class="assess-name">${escapeHtml(run.scientific_name || 'Untitled summary')}</h3>
                   <button class="icon-btn" data-rename="${g.seriesId}" title="Rename assessment" aria-label="Rename assessment">✎</button>
                 </div>`}
            <div class="assess-meta mono small">
              ${escapeHtml(run.generated_by_model || 'model')}
              ${rc != null ? ` · ${rc} item${rc === 1 ? '' : 's'}` : ''}
              · ${escapeHtml(fmtDate(run.generated_at || run.created_at))}
            </div>
          </div>
          <div class="assess-doc-actions">
            <button class="btn ghost sm" data-rerun="${run.id}" ${state.busy ? 'disabled' : ''}>Rerun →</button>
            <button class="btn danger sm" data-delrun="${run.id}">Delete</button>
          </div>
        </div>

        ${versionsAsc.length > 1 ? `
          <div class="version-bar">
            <span class="version-bar-label">Versions</span>
            ${versionsAsc.map(r => `
              <button class="version-pill ${r.id === run.id ? 'active' : ''}" data-ver="${r.id}"
                title="${escapeHtml(fmtDate(r.generated_at || r.created_at))}">
                v${r.version}${r.id === g.latest.id ? ' ·latest' : ''}
              </button>`).join('')}
          </div>` : ''}

        ${taxa.length ? `<div class="assess-taxa">${taxa.map(t => `<span class="taxa-chip">${escapeHtml(t)}</span>`).join('')}</div>` : ''}

        <div class="assess-curate">
          <label>Category
            <select class="select sm" data-cat="${run.id}">
              ${IUCN_CATEGORIES.map(c => `<option value="${c}" ${(run.iucn_category || '') === c ? 'selected' : ''}>${c || '—'}</option>`).join('')}
            </select>
          </label>
          <label>Criteria
            <input class="input sm" data-crit="${run.id}" value="${escapeHtml(run.iucn_criteria || '')}" placeholder="e.g. B1ab(iii)" />
          </label>
          <label>Status
            <select class="select sm" data-status="${run.id}">
              ${STATUSES.map(s => `<option value="${s}" ${run.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </label>
        </div>

        <div class="assess-sections">
          ${SECTION_ORDER.map(key => `
            <div class="assess-section">
              <div class="assess-section-title">${escapeHtml(prettyKey(key))}</div>
              <div class="assess-section-body">${sections[key] ? linkifySection(sections[key]) : '<span class="muted small">—</span>'}</div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  // Rename applies to the whole series so the rail + every version stay in sync.
  async function renameSeries(group, newName) {
    const name = (newName || '').trim();
    state.renaming = null;
    if (!name || name === (group.latest.scientific_name || '')) { render(); return; }
    try {
      await Promise.all(group.runs.map(r => window.IRIS.api.assessments.update(r.id, { scientific_name: name })));
      await load();
      render();
      window.IRIS.toast('Assessment renamed.');
    } catch (err) { window.IRIS.toast(err.message, 'error'); render(); }
  }

  function wireDetail(container, groups) {
    // Inline rename: pencil → editable name; Enter/Save commits, Esc/Cancel aborts.
    const renameBtn = container.querySelector('[data-rename]');
    if (renameBtn) renameBtn.addEventListener('click', () => {
      state.renaming = Number(renameBtn.dataset.rename);
      render();
    });
    const renameInput = container.querySelector('[data-rename-input]');
    if (renameInput) {
      const g = groups.find(gr => gr.seriesId === state.renaming);
      renameInput.focus();
      renameInput.select();
      renameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); renameSeries(g, renameInput.value); }
        else if (e.key === 'Escape') { e.preventDefault(); state.renaming = null; render(); }
      });
      const save = container.querySelector('[data-rename-save]');
      if (save) save.addEventListener('click', () => renameSeries(g, renameInput.value));
      const cancel = container.querySelector('[data-rename-cancel]');
      if (cancel) cancel.addEventListener('click', () => { state.renaming = null; render(); });
    }
    container.querySelectorAll('[data-ver]').forEach(b => b.addEventListener('click', () => {
      const doc = b.closest('[data-series]');
      const sid = Number(doc.dataset.series);
      state.selectedVersion[sid] = Number(b.dataset.ver);
      render();
    }));
    container.querySelectorAll('[data-rerun]').forEach(b => b.addEventListener('click', () => {
      const run = state.runs.find(r => r.id === Number(b.dataset.rerun));
      if (run) rerun(run);
    }));
    container.querySelectorAll('[data-delrun]').forEach(b => b.addEventListener('click', () => {
      const run = state.runs.find(r => r.id === Number(b.dataset.delrun));
      const g = groups.find(gr => gr.runs.some(r => r.id === run.id));
      if (run && g) deleteRun(run, g);
    }));
    container.querySelectorAll('[data-cat]').forEach(sel => sel.addEventListener('change', () => {
      const run = state.runs.find(r => r.id === Number(sel.dataset.cat));
      if (run) patchRun(run, { iucn_category: sel.value || null });
    }));
    container.querySelectorAll('[data-crit]').forEach(inp => inp.addEventListener('change', () => {
      const run = state.runs.find(r => r.id === Number(inp.dataset.crit));
      if (run) patchRun(run, { iucn_criteria: inp.value || null });
    }));
    container.querySelectorAll('[data-status]').forEach(sel => sel.addEventListener('change', () => {
      const run = state.runs.find(r => r.id === Number(sel.dataset.status));
      if (run) patchRun(run, { status: sel.value });
    }));
  }

  // Inline specimen citations: hover → the same specimen card as the map;
  // click → open the specimen image in the lightbox.
  function wireCitations(container) {
    if (window.IRIS.SpecimenCard) window.IRIS.SpecimenCard.hideHover();
    container.querySelectorAll('.specimen-link').forEach(a => {
      const item = state.itemsById.get(Number(a.dataset.sid));
      if (!item) return;
      a.addEventListener('mouseenter', () => window.IRIS.SpecimenCard.showHover(a, item, { canFlag: state.canFlag }));
      a.addEventListener('mouseleave', () => window.IRIS.SpecimenCard.scheduleHide());
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const original = `iris-source://source/${item.source_id}`;
        const images = [{ key: 'original', label: 'Original', src: original }];
        if (item.has_cropped_image && item.vv_id) images.push({ key: 'cropped', label: 'Crop', src: `iris-source://vv/${item.vv_id}/cropped` });
        window.IRIS.Lightbox.open({ images, activeKey: images[images.length - 1].key, title: item.scientific_name || item.filename });
      });
    });
  }

  async function mount(container) {
    state.container = container;
    const active = window.IRIS.session.getCurrentProject();
    if (!active) {
      window.IRIS.ProjectPage.noProjectPlaceholder(container, {
        title: 'Assessment', subtitle: 'IUCN Red List drafting & review',
      });
      return;
    }
    if (state.projectId !== active.id) {
      state.projectId = active.id;
      state.runs = [];
      state.items = [];
      state.selectedVersion = {};
      state.activeSeriesId = null;
      state.renaming = null;
      state.view = 'detail';
    }
    container.innerHTML = '<div class="page-body"><div class="empty-list">Loading…</div></div>';
    await loadRole();
    await load();

    // Handoff from the Library's "Summarize selected" → open the builder with
    // those items pre-checked.
    const pending = window.IRIS.pendingSummary && window.IRIS.pendingSummary.projectId === state.projectId
      ? window.IRIS.pendingSummary : null;
    if (pending && pending.sourceIds && pending.sourceIds.length) {
      window.IRIS.pendingSummary = null;
      openBuilder(pending.sourceIds);
      return;
    }
    render();
  }

  window.IRIS = window.IRIS || {};
  window.IRIS.AssessmentPage = { mount };
})();
