/*
 * Minimal promise-based modal dialog with one or more buttons.
 *
 *   const choice = await window.IRIS.dialog({
 *     title: 'Duplicate uploads',
 *     message: '<p>…already-escaped HTML…</p>',
 *     buttons: [
 *       { label: 'Skip duplicates', value: 'skip', variant: 'primary' },
 *       { label: 'Upload anyway',   value: 'force' },
 *       { label: 'Cancel',          value: null, variant: 'ghost' },
 *     ],
 *   });
 *
 * Resolves to the chosen button's `value` (or null on Esc / backdrop click).
 * `message` is inserted as HTML — the caller escapes any user content.
 */

(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
    }[c]));
  }
  function root() {
    let r = document.getElementById('modal-root');
    if (!r) { r = document.createElement('div'); r.id = 'modal-root'; document.body.appendChild(r); }
    return r;
  }
  function btnClass(variant) {
    if (variant === 'primary') return 'btn sm';
    if (variant === 'danger')  return 'btn danger sm';
    return 'btn ghost sm';
  }

  function dialog({ title = '', message = '', buttons } = {}) {
    const btns = buttons && buttons.length ? buttons : [{ label: 'OK', value: true, variant: 'primary' }];
    return new Promise((resolve) => {
      const r = root();
      const finish = (v) => { document.removeEventListener('keydown', onKey); r.innerHTML = ''; resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') finish(null); };
      r.innerHTML = `
        <div class="modal-backdrop" data-backdrop>
          <div class="modal-card" role="dialog" aria-modal="true">
            ${title ? `<div class="modal-title">${esc(title)}</div>` : ''}
            <div class="modal-body">${message}</div>
            <div class="modal-actions">
              ${btns.map((b, i) => `<button class="${btnClass(b.variant)}" data-i="${i}">${esc(b.label)}</button>`).join('')}
            </div>
          </div>
        </div>`;
      r.querySelectorAll('[data-i]').forEach(el =>
        el.addEventListener('click', () => finish(btns[Number(el.dataset.i)].value)));
      const bd = r.querySelector('[data-backdrop]');
      bd.addEventListener('click', (e) => { if (e.target === bd) finish(null); });
      document.addEventListener('keydown', onKey);
    });
  }

  /*
   * Promise-based text-input prompt — a working replacement for window.prompt(),
   * which Electron's renderer does NOT support (it returns null). Resolves to the
   * trimmed string, or null on Cancel / Esc / empty.
   */
  function promptText({ title = '', label = '', value = '', placeholder = '', confirmLabel = 'OK' } = {}) {
    return new Promise((resolve) => {
      const r = root();
      const finish = (v) => { document.removeEventListener('keydown', onKey); r.innerHTML = ''; resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') finish(null); };
      r.innerHTML = `
        <div class="modal-backdrop" data-backdrop>
          <div class="modal-card" role="dialog" aria-modal="true">
            ${title ? `<div class="modal-title">${esc(title)}</div>` : ''}
            ${label ? `<div class="modal-body">${esc(label)}</div>` : ''}
            <input class="input modal-input" id="modal-input" value="${esc(value)}" placeholder="${esc(placeholder)}" />
            <div class="modal-actions">
              <button class="btn ghost sm" data-cancel>Cancel</button>
              <button class="btn sm" data-ok>${esc(confirmLabel)}</button>
            </div>
          </div>
        </div>`;
      const input = r.querySelector('#modal-input');
      const submit = () => finish(input.value.trim() || null);
      r.querySelector('[data-ok]').addEventListener('click', submit);
      r.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      const bd = r.querySelector('[data-backdrop]');
      bd.addEventListener('click', (e) => { if (e.target === bd) finish(null); });
      document.addEventListener('keydown', onKey);
      setTimeout(() => { input.focus(); input.select(); }, 0);
    });
  }

  window.IRIS = window.IRIS || {};
  window.IRIS.dialog = dialog;
  window.IRIS.promptText = promptText;
})();
