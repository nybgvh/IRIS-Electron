/*
 * SpecimenCard — the little specimen preview (image with Original/Crop toggle,
 * name, filename, flag button) shown by the Geography map popup AND by the
 * hover over an inline specimen citation in an assessment. One renderer so both
 * look identical.
 *
 *   SpecimenCard.html(item, { canFlag })        → inner HTML (a .geo-popup)
 *   SpecimenCard.wire(rootEl, item, { canFlag, onFlag })  → wire toggle/flag/zoom
 *   SpecimenCard.showHover(anchorEl, item, opts)          → floating hovercard
 *   SpecimenCard.scheduleHide() / hideHover()
 *
 * `item` is an item-repo shape: source_id, vv_id, filename, scientific_name,
 * has_cropped_image, flagged, formatted.
 */

(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
    }[c]));
  }

  function html(item, { canFlag = false } = {}) {
    const hasCrop = item.has_cropped_image && item.vv_id;
    const original = `iris-source://source/${item.source_id}`;
    const cropped = hasCrop ? `iris-source://vv/${item.vv_id}/cropped` : original;
    const startCrop = !!hasCrop;
    return `
      <div class="geo-popup" data-sid="${item.source_id}">
        <div class="geo-popup-img">
          <img id="spec-img-${item.source_id}" src="${startCrop ? cropped : original}"
               data-original="${original}" data-cropped="${cropped}" data-active="${startCrop ? 'cropped' : 'original'}"
               alt="${esc(item.filename)}" draggable="false" />
        </div>
        <div class="geo-popup-bar">
          ${hasCrop ? `<div class="img-toggle">
            <button class="chip ${startCrop ? '' : 'active'}" data-imk="original">Original</button>
            <button class="chip ${startCrop ? 'active' : ''}" data-imk="cropped">Crop</button>
          </div>` : '<span></span>'}
          <button class="flag-btn ${item.flagged ? 'on' : ''}" data-flag="${item.source_id}"
            title="${canFlag ? 'Flag this specimen' : 'Flagging needs editor role'}" ${canFlag ? '' : 'disabled'}>⚑</button>
        </div>
        <div class="geo-popup-name">${esc(item.scientific_name || item.filename)}</div>
        <div class="geo-popup-file mono small">${esc(item.filename)}</div>
      </div>`;
  }

  function wire(rootEl, item, { onFlag } = {}) {
    const el = rootEl.querySelector('.geo-popup');
    if (!el) return;
    const img = el.querySelector(`#spec-img-${item.source_id}`);

    el.querySelectorAll('[data-imk]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!img) return;
      img.src = b.dataset.imk === 'cropped' ? img.dataset.cropped : img.dataset.original;
      img.dataset.active = b.dataset.imk;
      el.querySelectorAll('[data-imk]').forEach(x => x.classList.toggle('active', x === b));
    }));

    if (img) {
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        const images = [{ key: 'original', label: 'Original', src: img.dataset.original }];
        if (img.dataset.cropped && img.dataset.cropped !== img.dataset.original) {
          images.push({ key: 'cropped', label: 'Crop', src: img.dataset.cropped });
        }
        window.IRIS.Lightbox.open({ images, activeKey: img.dataset.active || 'original',
          title: item.scientific_name || item.filename });
      });
    }

    const fb = el.querySelector('[data-flag]');
    if (fb && !fb.disabled) fb.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const upd = await window.IRIS.api.sources.flag(item.source_id, !item.flagged);
        item.flagged = !!upd.flagged;
        fb.classList.toggle('on', item.flagged);
        window.IRIS.toast(item.flagged ? 'Flagged.' : 'Unflagged.');
        if (onFlag) onFlag(item);
      } catch (err) { window.IRIS.toast(err.message || 'Could not flag.', 'error'); }
    });
  }

  // ----- floating hovercard (for inline citation links) --------------------
  let hideTimer = null;

  function hoverRoot() {
    let r = document.getElementById('spec-hovercard-root');
    if (!r) { r = document.createElement('div'); r.id = 'spec-hovercard-root'; document.body.appendChild(r); }
    return r;
  }

  function showHover(anchor, item, opts = {}) {
    clearTimeout(hideTimer);
    const root = hoverRoot();
    root.innerHTML = `<div class="spec-hovercard">${html(item, opts)}</div>`;
    const card = root.firstElementChild;
    position(card, anchor);
    wire(card, item, opts);
    card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    card.addEventListener('mouseleave', scheduleHide);
  }

  function position(card, anchor) {
    const r = anchor.getBoundingClientRect();
    const cw = card.offsetWidth || 280;
    const ch = card.offsetHeight || 260;
    let left = r.left;
    let top = r.bottom + 8;
    if (left + cw > window.innerWidth - 8) left = window.innerWidth - cw - 8;
    if (left < 8) left = 8;
    if (top + ch > window.innerHeight - 8) top = r.top - ch - 8;   // flip above
    if (top < 8) top = 8;
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(hideHover, 250); }
  function hideHover() {
    clearTimeout(hideTimer);
    const r = document.getElementById('spec-hovercard-root');
    if (r) r.innerHTML = '';
  }

  window.IRIS = window.IRIS || {};
  window.IRIS.SpecimenCard = { html, wire, showHover, scheduleHide, hideHover };
})();
