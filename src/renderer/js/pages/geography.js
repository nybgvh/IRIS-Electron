/*
 * Geography tab.
 *
 * Plots every georeferenced specimen (decimalLatitude/Longitude from the
 * VoucherVision formatted_json) on a Leaflet map, draws the convex-hull
 * polygon around them (the IUCN Extent-of-Occurrence shape), and reports that
 * polygon in several copy-to-clipboard formats.
 *
 * Points are green by default; a per-item "flag" (shared DB state) turns a
 * point orange. Hovering a point opens a popup with the specimen image
 * (original/crop toggle), its filename, and a flag toggle.
 *
 * Tile providers match the VVGO webpage (CARTO + Esri); the user picks the
 * base layer. Leaflet is vendored locally (js/lib) — no CDN, CSP-clean.
 */

(function () {
  const GREEN = '#25a05a';   // default point (pleasing green)
  const ORANGE = '#ff5e27';  // flagged point
  const HULL_LINE = '#8a8a8a';
  const HULL_FILL = '#b8b8b8';
  // A point tagged with this is left OUT of the convex-hull / EOO computation.
  const EXCLUDE_TAG = 'excluded polygon';
  const EXCLUDE_COLOR = '#857363'; // warm-gray

  function isExcluded(item) {
    return (item.tags || []).some(t => (t.name || '').toLowerCase() === EXCLUDE_TAG);
  }

  // Tile layers — ported from the VVGO webpage / VVGO-Editor.
  const TILES = {
    light:     { label: 'Streets',   url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', attribution: '&copy; CARTO &copy; OSM', options: { maxZoom: 19, subdomains: 'abcd' } },
    satellite: { label: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: '&copy; Esri', options: { maxZoom: 18 } },
    topo:      { label: 'Topo',      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', attribution: '&copy; Esri', options: { maxZoom: 18 } },
    dark:      { label: 'Dark',      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attribution: '&copy; CARTO &copy; OSM', options: { maxZoom: 19, subdomains: 'abcd' } },
  };

  const state = {
    container: null,
    projectId: null,
    role: null,
    points: [],          // [{ item, lat, lng }]
    map: null,
    tileKey: 'light',
    tileLayer: null,
    markers: new Map(),  // source_id → circleMarker
    hull: [],            // [{lat, lng}]  (from non-excluded points)
    hullLayer: null,     // the Leaflet polygon, so it can be redrawn on exclude
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
    }[c]));
  }
  const canFlag = () => state.role === 'owner' || state.role === 'editor';

  // --- geometry ------------------------------------------------------------
  // Andrew's monotone-chain convex hull. Input/output as {lat,lng}; computed
  // on x=lng, y=lat. Returns ordered hull vertices (CCW), or [] if <3 unique.
  function convexHull(pts) {
    const uniq = [];
    const seen = new Set();
    for (const p of pts) {
      const k = `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
      if (!seen.has(k)) { seen.add(k); uniq.push(p); }
    }
    if (uniq.length < 3) return [];
    const P = uniq.slice().sort((a, b) => a.lng - b.lng || a.lat - b.lat);
    const cross = (o, a, b) => (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
    const lower = [];
    for (const p of P) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  // Geodesic area of a lat/lng ring, in km² (spherical excess approximation).
  function hullAreaKm2(ring) {
    if (ring.length < 3) return 0;
    const R = 6378137, rad = d => d * Math.PI / 180;
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      sum += (rad(b.lng) - rad(a.lng)) * (2 + Math.sin(rad(a.lat)) + Math.sin(rad(b.lat)));
    }
    return Math.abs(sum * R * R / 2) / 1e6;
  }

  // --- data ----------------------------------------------------------------
  async function loadRole() {
    const user = window.IRIS.session.get();
    if (user && user.role === 'admin') { state.role = 'owner'; return; }
    try {
      const members = await window.IRIS.api.members.list(state.projectId);
      const mine = members.find(m => Number(m.user_id) === Number(user.id));
      state.role = mine ? mine.role : null;
    } catch (_) { state.role = null; }
  }

  function coordsOf(item) {
    const f = item.formatted || {};
    const lat = parseFloat(f.decimalLatitude);
    const lng = parseFloat(f.decimalLongitude);
    if (isNaN(lat) || isNaN(lng)) return null;
    if (lat === 0 && lng === 0) return null;             // null island
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  async function loadPoints() {
    state.points = [];
    try {
      const items = await window.IRIS.api.items.list(state.projectId, {});
      for (const it of items) {
        const c = coordsOf(it);
        if (c) state.points.push({ item: it, lat: c.lat, lng: c.lng });
      }
    } catch (err) {
      window.IRIS.toast(`Could not load specimens: ${err.message}`, 'error');
    }
  }

  // --- render shell --------------------------------------------------------
  function render() {
    const active = window.IRIS.session.getCurrentProject();
    const n = state.points.length;
    state.container.innerHTML = `
      <div class="page-toolbar">
        ${window.IRIS.pageHeader({
          label: 'Geography',
          name: active.name,
          meta: `${n} georeferenced specimen${n === 1 ? '' : 's'}`,
        })}
        <div class="spacer"></div>
        <div class="map-layer-switch" id="layer-switch">
          ${Object.entries(TILES).map(([k, t]) =>
            `<button class="chip ${k === state.tileKey ? 'active' : ''}" data-layer="${k}">${t.label}</button>`).join('')}
        </div>
      </div>
      <div class="geo-wrap">
        <div class="geo-map" id="geo-map"></div>
        <aside class="geo-side" id="geo-side"></aside>
      </div>
    `;
    state.container.querySelectorAll('[data-layer]').forEach(b =>
      b.addEventListener('click', () => switchLayer(b.dataset.layer)));

    if (n === 0) {
      document.getElementById('geo-map').innerHTML =
        `<div class="geo-empty"><div class="glyph">◉</div>
          <p>No specimens have coordinates yet.<br/>
          Process specimens whose labels include a locality — decimal latitude/longitude
          appear here automatically.</p></div>`;
      renderSide();
      return;
    }
    buildMap();
    renderSide();
  }

  // --- map -----------------------------------------------------------------
  function switchLayer(key) {
    state.tileKey = key;
    state.container.querySelectorAll('[data-layer]').forEach(b =>
      b.classList.toggle('active', b.dataset.layer === key));
    if (state.map && state.tileLayer) {
      state.map.removeLayer(state.tileLayer);
      const t = TILES[key];
      state.tileLayer = L.tileLayer(t.url, { attribution: t.attribution, ...t.options }).addTo(state.map);
    }
  }

  function buildMap() {
    if (state.map) { try { state.map.remove(); } catch (_) {} state.map = null; }
    state.markers.clear();

    const map = L.map('geo-map', { zoomControl: true, worldCopyJump: true });
    state.map = map;
    const t = TILES[state.tileKey];
    state.tileLayer = L.tileLayer(t.url, { attribution: t.attribution, ...t.options }).addTo(map);

    // hull polygon first so points draw on top (computed from non-excluded pts)
    state.hullLayer = null;
    drawHull();

    // points
    const maxW = Math.max(440, Math.round(window.innerWidth * 0.4));
    for (const p of state.points) {
      const marker = L.circleMarker([p.lat, p.lng], markerStyle(p.item))
        .addTo(map)
        .bindPopup(popupHtml(p), { maxWidth: maxW, minWidth: 420, className: 'geo-popup-wrap', autoClose: true });
      marker._pt = p;
      marker.on('mouseover', () => marker.openPopup());
      state.markers.set(p.item.source_id, marker);
    }

    map.on('popupopen', (e) => wirePopup(e.popup));

    // zoom to enclose. invalidateSize first so the container's real dimensions
    // are known, and disable the fly animation — an in-flight zoom animation
    // that resolves after a tab switch throws Leaflet's `_leaflet_pos` error.
    const bounds = L.latLngBounds(state.points.map(p => [p.lat, p.lng]));
    const fit = () => {
      // bail if this map was replaced/removed by a later mount (its panes are
      // gone → invalidateSize would throw on the dead instance)
      if (state.map !== map || !map._mapPane) return;
      map.invalidateSize(false);
      if (state.points.length === 1) map.setView([state.points[0].lat, state.points[0].lng], 8, { animate: false });
      else map.fitBounds(bounds.pad(0.15), { animate: false });
    };
    fit();
    setTimeout(fit, 80);   // re-fit once layout settles (container just inserted)
  }

  function markerStyle(item) {
    // Excluded points are greyed + dashed so it's clear they're out of the EOO.
    if (isExcluded(item)) {
      return { radius: 6, weight: 1.5, color: '#6b6b6b', dashArray: '2,3', fillColor: '#b8b3aa', fillOpacity: 0.4 };
    }
    return { radius: 7, weight: 1.5, color: '#2b2b2b',
      fillColor: item.flagged ? ORANGE : GREEN, fillOpacity: 0.9 };
  }

  // (Re)compute the hull from the NON-excluded points and (re)draw its polygon.
  function drawHull() {
    const map = state.map;
    if (!map) return;
    state.hull = convexHull(state.points.filter(p => !isExcluded(p.item)).map(p => ({ lat: p.lat, lng: p.lng })));
    if (state.hullLayer) { try { map.removeLayer(state.hullLayer); } catch (_) {} state.hullLayer = null; }
    if (state.hull.length >= 3) {
      state.hullLayer = L.polygon(state.hull.map(p => [p.lat, p.lng]), {
        color: HULL_LINE, weight: 2, opacity: 0.9, fillColor: HULL_FILL, fillOpacity: 0.15,
      }).addTo(map);
      try { state.hullLayer.bringToBack(); } catch (_) {}  // keep points on top (no-op if SVG not ready)
    }
  }

  // Recompute the polygon + refresh the EOO/export panel after an exclusion change.
  function redrawHull() { drawHull(); renderSide(); }

  // --- popup ---------------------------------------------------------------
  function popupHtml(p) {
    const it = p.item;
    const hasCrop = it.has_cropped_image && it.vv_id;
    const original = `iris-source://source/${it.source_id}`;
    const cropped = hasCrop ? `iris-source://vv/${it.vv_id}/cropped` : original;
    const startCrop = hasCrop;
    return `
      <div class="geo-popup" data-sid="${it.source_id}">
        <div class="geo-popup-img">
          <img id="geo-pop-img-${it.source_id}" src="${startCrop ? cropped : original}"
               data-original="${original}" data-cropped="${cropped}" alt="${escapeHtml(it.filename)}" />
        </div>
        <div class="geo-popup-bar">
          ${hasCrop ? `<div class="img-toggle" data-sid="${it.source_id}">
            <button class="chip ${startCrop ? '' : 'active'}" data-imk="original">Original</button>
            <button class="chip ${startCrop ? 'active' : ''}" data-imk="cropped">Crop</button>
          </div>` : '<span></span>'}
          <div class="geo-popup-actions">
            <button class="excl-btn ${isExcluded(it) ? 'on' : ''}" data-exclude="${it.source_id}"
              title="${canFlag() ? 'Exclude/include this point in the EOO polygon (tags it “excluded polygon”)' : 'Needs editor role'}" ${canFlag() ? '' : 'disabled'}>${isExcluded(it) ? 'Include in polygon' : 'Exclude from polygon'}</button>
            <button class="flag-btn ${it.flagged ? 'on' : ''}" data-flag="${it.source_id}"
              title="${canFlag() ? 'Flag this specimen' : 'Flagging needs editor role'}" ${canFlag() ? '' : 'disabled'}>⚑</button>
          </div>
        </div>
        <div class="geo-popup-name mono">${escapeHtml(it.scientific_name || it.filename)}</div>
        <div class="geo-popup-file mono small">${escapeHtml(it.filename)}</div>
      </div>`;
  }

  function wirePopup(popup) {
    const root = popup.getElement && popup.getElement();
    if (!root) return;
    const el = root.querySelector('.geo-popup');
    if (!el) return;
    const sid = Number(el.dataset.sid);

    el.querySelectorAll('[data-imk]').forEach(b => b.addEventListener('click', () => {
      const img = document.getElementById(`geo-pop-img-${sid}`);
      if (!img) return;
      img.src = b.dataset.imk === 'cropped' ? img.dataset.cropped : img.dataset.original;
      el.querySelectorAll('[data-imk]').forEach(x => x.classList.toggle('active', x === b));
    }));

    // click the image → fullscreen zoomable lightbox
    const popImg = document.getElementById(`geo-pop-img-${sid}`);
    if (popImg) {
      popImg.style.cursor = 'zoom-in';
      popImg.addEventListener('click', () => {
        const original = popImg.dataset.original;
        const cropped = popImg.dataset.cropped;
        const images = [{ key: 'original', label: 'Original', src: original }];
        if (cropped && cropped !== original) images.push({ key: 'cropped', label: 'Crop', src: cropped });
        const activeKey = (popImg.src === cropped && cropped !== original) ? 'cropped' : 'original';
        const p = state.points.find(pt => pt.item.source_id === sid);
        const title = p ? (p.item.scientific_name || p.item.filename) : '';
        window.IRIS.Lightbox.open({ images, activeKey, title });
      });
    }

    const flagBtn = el.querySelector('[data-flag]');
    if (flagBtn && !flagBtn.disabled) flagBtn.addEventListener('click', () => toggleFlag(sid, flagBtn));

    const exclBtn = el.querySelector('[data-exclude]');
    if (exclBtn && !exclBtn.disabled) exclBtn.addEventListener('click', () => toggleExclude(sid, exclBtn));
  }

  // Toggle a point's exclusion from the EOO polygon. Exclusion is stored as the
  // "excluded polygon" tag on the source, so it persists and is filterable in
  // the Library. Recomputes the hull + EOO from the remaining points.
  async function toggleExclude(sourceId, btnEl) {
    const p = state.points.find(pt => pt.item.source_id === sourceId);
    if (!p) return;
    const wasExcluded = isExcluded(p.item);
    if (btnEl) btnEl.disabled = true;
    try {
      const tag = await window.IRIS.api.tags.create(state.projectId, { name: EXCLUDE_TAG, color: EXCLUDE_COLOR });
      if (wasExcluded) {
        await window.IRIS.api.tags.unassign(sourceId, tag.id);
        p.item.tags = (p.item.tags || []).filter(t => t.id !== tag.id);
      } else {
        await window.IRIS.api.tags.assign(sourceId, tag.id);
        p.item.tags = [...(p.item.tags || []), { id: tag.id, name: EXCLUDE_TAG, color: EXCLUDE_COLOR }];
      }
      const nowExcluded = !wasExcluded;
      const marker = state.markers.get(sourceId);
      if (marker) marker.setStyle(markerStyle(p.item));
      redrawHull();
      if (btnEl) {
        btnEl.classList.toggle('on', nowExcluded);
        btnEl.textContent = nowExcluded ? 'Include in polygon' : 'Exclude from polygon';
      }
      window.IRIS.toast(nowExcluded ? 'Excluded from the polygon.' : 'Included in the polygon.');
    } catch (err) {
      window.IRIS.toast(err.message || 'Could not update the polygon.', 'error');
    } finally {
      if (btnEl) btnEl.disabled = false;
    }
  }

  async function toggleFlag(sourceId, btnEl) {
    const p = state.points.find(pt => pt.item.source_id === sourceId);
    if (!p) return;
    const next = !p.item.flagged;
    try {
      await window.IRIS.api.sources.flag(sourceId, next);
      p.item.flagged = next;
      if (btnEl) btnEl.classList.toggle('on', next);
      const marker = state.markers.get(sourceId);
      if (marker) marker.setStyle(markerStyle(p.item));
      window.IRIS.toast(next ? 'Flagged.' : 'Unflagged.');
    } catch (err) {
      window.IRIS.toast(err.message || 'Could not flag.', 'error');
    }
  }

  // --- side panel: polygon formats -----------------------------------------
  function renderSide() {
    const el = document.getElementById('geo-side');
    if (!el) return;
    const hull = state.hull;
    const nPts = state.points.length;
    const included = state.points.filter(p => !isExcluded(p.item)).length;
    const excluded = nPts - included;

    if (hull.length < 3) {
      el.innerHTML = `
        <div class="geo-side-head">Extent of Occurrence</div>
        <p class="muted small">${nPts === 0
          ? 'No georeferenced specimens.'
          : `Only ${included} included point${included === 1 ? '' : 's'} — at least 3 distinct points are needed to draw a polygon${excluded ? ` (${excluded} excluded)` : ''}.`}</p>
        ${nPts ? `<div class="fmt-block"><div class="fmt-head">Points</div>
          <textarea class="fmt-text" readonly rows="4">${escapeHtml(coordList(state.points.map(p => ({lat:p.lat,lng:p.lng}))))}</textarea>
          <button class="btn ghost sm" data-copy="pts">Copy</button></div>` : ''}
      `;
      el.querySelectorAll('[data-copy="pts"]').forEach(b => b.addEventListener('click',
        () => copy(coordList(state.points.map(p => ({lat:p.lat,lng:p.lng}))), b)));
      return;
    }

    const area = hullAreaKm2(hull);
    const formats = [
      ['WKT',      wkt(hull),            2],
      ['GeoJSON',  geojson(hull),        4],
      ['Coordinates (lat, lng)', coordList(hull), 4],
    ];
    el.innerHTML = `
      <div class="geo-side-head">Extent of Occurrence</div>
      <div class="geo-eoo">
        <div><span class="eoo-num">${area.toLocaleString(undefined, { maximumFractionDigits: area < 100 ? 2 : 0 })}</span> km²</div>
        <div class="muted small">${hull.length}-vertex convex hull · ${included} specimen${included === 1 ? '' : 's'}${excluded ? ` · ${excluded} excluded` : ''}</div>
      </div>
      ${formats.map(([label, text, rows], i) => `
        <div class="fmt-block">
          <div class="fmt-head">${escapeHtml(label)}
            <button class="btn ghost sm" data-copy="${i}">Copy</button>
          </div>
          <textarea class="fmt-text" readonly rows="${rows}">${escapeHtml(text)}</textarea>
        </div>`).join('')}
    `;
    formats.forEach(([, text], i) => {
      const b = el.querySelector(`[data-copy="${i}"]`);
      if (b) b.addEventListener('click', () => copy(text, b));
    });
  }

  // format builders (hull is [{lat,lng}] in ring order)
  function wkt(h) {
    const ring = h.concat([h[0]]);
    return `POLYGON((${ring.map(p => `${p.lng} ${p.lat}`).join(', ')}))`;
  }
  function geojson(h) {
    const ring = h.concat([h[0]]).map(p => [p.lng, p.lat]);
    return JSON.stringify({ type: 'Polygon', coordinates: [ring] });
  }
  function coordList(pts) {
    return pts.map(p => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`).join('\n');
  }

  async function copy(text, btnEl) {
    try {
      await navigator.clipboard.writeText(text);
      if (btnEl) { const t = btnEl.textContent; btnEl.textContent = 'Copied ✓'; setTimeout(() => { btnEl.textContent = t; }, 1200); }
    } catch (_) { window.IRIS.toast('Copy failed.', 'error'); }
  }

  // --- entry ---------------------------------------------------------------
  async function mount(container) {
    state.container = container;
    const active = window.IRIS.session.getCurrentProject();
    // tearing down a prior map avoids Leaflet "container reused" errors
    if (state.map) { try { state.map.remove(); } catch (_) {} state.map = null; }
    if (!active) {
      window.IRIS.ProjectPage.noProjectPlaceholder(container, {
        title: 'Geography', subtitle: 'collection localities, ranges, and georeferencing',
      });
      return;
    }
    state.projectId = active.id;
    container.innerHTML = '<div class="page-body"><div class="empty-list">Loading map…</div></div>';
    await loadRole();
    await loadPoints();
    render();
  }

  window.IRIS = window.IRIS || {};
  window.IRIS.GeographyPage = {
    mount,
    // test seams
    _openFirstPopup: () => { const m = state.markers.values().next().value; if (m) m.openPopup(); },
    _hullVertices: () => state.hull.length,
  };
})();
