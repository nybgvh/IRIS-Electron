/*
 * Fullscreen image lightbox with zoom + pan. Reusable across pages.
 *
 *   window.IRIS.Lightbox.open({
 *     images: [{ key, label, src }, ...],   // one or more (e.g. Original / Crop)
 *     activeKey,                            // which to show first
 *     title,                                // caption (e.g. specimen name)
 *   });
 *
 * Zoom: mouse wheel (cursor-centered) or the +/− buttons; double-click toggles
 * 2× / fit. Pan: drag when zoomed in. Close: ✕, the backdrop, or Esc. No deps —
 * pure CSS transforms. Styled with the app's tokens/classes.
 */

(function () {
  const MIN = 1, MAX = 16;
  let st = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
    }[c]));
  }
  function root() {
    let r = document.getElementById('lightbox-root');
    if (!r) { r = document.createElement('div'); r.id = 'lightbox-root'; document.body.appendChild(r); }
    return r;
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const current = () => st.images.find(i => i.key === st.activeKey) || st.images[0];

  function open({ images, activeKey, title }) {
    if (!images || !images.length) return;
    close();
    st = { images, activeKey: activeKey || images[0].key, title: title || '',
           scale: 1, tx: 0, ty: 0, drag: null };
    render();
    // Drag listeners live for the whole open session (not per-render) so
    // panning keeps working across multiple drags and image toggles.
    document.addEventListener('keydown', onKey);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function close() {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    const r = document.getElementById('lightbox-root');
    if (r) r.innerHTML = '';
    st = null;
  }

  function onKey(e) {
    if (!st) return;
    if (e.key === 'Escape') close();
    else if (e.key === '+' || e.key === '=') zoomAt(centerX(), centerY(), 1.2);
    else if (e.key === '-') zoomAt(centerX(), centerY(), 1 / 1.2);
  }

  function render() {
    const img = current();
    root().innerHTML = `
      <div class="lightbox" id="lightbox">
        <div class="lightbox-topbar">
          <div class="lightbox-title">
            <span class="lb-name">${esc(st.title)}</span>
            <span class="lb-label mono small">${esc(img.label || '')}</span>
          </div>
          <div class="lightbox-tools">
            ${st.images.length > 1 ? `<div class="lb-toggle">${
              st.images.map(i => `<button class="chip ${i.key === st.activeKey ? 'active' : ''}" data-lb-key="${i.key}">${esc(i.label)}</button>`).join('')
            }</div>` : ''}
            <button class="btn ghost sm" data-lb="out" title="Zoom out">−</button>
            <span class="lightbox-zoom" id="lightbox-zoom">100%</span>
            <button class="btn ghost sm" data-lb="in" title="Zoom in">+</button>
            <button class="btn ghost sm" data-lb="reset" title="Fit">Fit</button>
            <button class="btn sm" data-lb="close" title="Close (Esc)">✕ Close</button>
          </div>
        </div>
        <div class="lightbox-stage" id="lightbox-stage">
          <img id="lightbox-img" src="${img.src}" draggable="false" alt="${esc(st.title)}" />
        </div>
      </div>`;
    wire();
    applyTransform();
  }

  function stage() { return document.getElementById('lightbox-stage'); }
  function centerX() { const r = stage().getBoundingClientRect(); return r.left + r.width / 2; }
  function centerY() { const r = stage().getBoundingClientRect(); return r.top + r.height / 2; }

  function applyTransform() {
    const img = document.getElementById('lightbox-img');
    if (!img) return;
    if (st.scale <= MIN) { st.tx = 0; st.ty = 0; }
    img.style.transform = `translate(${st.tx}px, ${st.ty}px) scale(${st.scale})`;
    img.style.cursor = st.scale > MIN ? (st.drag ? 'grabbing' : 'grab') : 'zoom-in';
    const z = document.getElementById('lightbox-zoom');
    if (z) z.textContent = `${Math.round(st.scale * 100)}%`;
  }

  // Zoom about a screen point (cursor), keeping that point fixed.
  function zoomAt(cx, cy, factor) {
    const r = stage().getBoundingClientRect();
    const ox = cx - (r.left + r.width / 2);
    const oy = cy - (r.top + r.height / 2);
    const next = clamp(st.scale * factor, MIN, MAX);
    const k = next / st.scale;
    st.tx = ox - k * (ox - st.tx);
    st.ty = oy - k * (oy - st.ty);
    st.scale = next;
    applyTransform();
  }

  function wire() {
    const lb = document.getElementById('lightbox');
    const stg = stage();
    const img = document.getElementById('lightbox-img');

    lb.querySelectorAll('[data-lb]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = b.dataset.lb;
      if (a === 'close') close();
      else if (a === 'in') zoomAt(centerX(), centerY(), 1.3);
      else if (a === 'out') zoomAt(centerX(), centerY(), 1 / 1.3);
      else if (a === 'reset') { st.scale = MIN; st.tx = 0; st.ty = 0; applyTransform(); }
    }));

    lb.querySelectorAll('[data-lb-key]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      st.activeKey = b.dataset.lbKey;
      st.scale = MIN; st.tx = 0; st.ty = 0;   // reset zoom on switch
      render();
    }));

    // click the backdrop (stage, not the image) closes
    stg.addEventListener('click', (e) => { if (e.target === stg) close(); });

    stg.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });

    img.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (st.scale > MIN) { st.scale = MIN; st.tx = 0; st.ty = 0; applyTransform(); }
      else zoomAt(e.clientX, e.clientY, 2.2);
    });

    // start a pan when zoomed in
    img.addEventListener('mousedown', (e) => {
      if (st.scale <= MIN) return;
      e.preventDefault();
      st.drag = { x: e.clientX, y: e.clientY, tx: st.tx, ty: st.ty };
      applyTransform();
    });
  }

  function onMove(e) {
    if (!st || !st.drag) return;
    st.tx = st.drag.tx + (e.clientX - st.drag.x);
    st.ty = st.drag.ty + (e.clientY - st.drag.y);
    applyTransform();
  }
  function onUp() {
    if (st && st.drag) { st.drag = null; applyTransform(); }
  }

  window.IRIS = window.IRIS || {};
  window.IRIS.Lightbox = { open, close };
})();
