/*
 * Shared page header for the top-of-tab toolbar: a pine→lettuce gradient accent
 * bar, an uppercase mono section label, the project name in serif, and an
 * uppercase mono meta line. Returns the left-side block to drop inside a
 * `.page-toolbar` (the page adds its own spacer + action buttons on the right).
 *
 *   `<div class="page-toolbar">${IRIS.pageHeader({label, name, meta})}
 *      <div class="spacer"></div> ...buttons... </div>`
 *
 * The meta node carries class `page-hd-meta`, so a page can update it live after
 * async data loads: `container.querySelector('.page-hd-meta').textContent = ...`.
 */
(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
    }[c]));
  }

  function pageHeader({ label = '', name = '', meta = '' } = {}) {
    return `<div class="page-hd">
      <div class="page-hd-bar"></div>
      <div class="page-hd-text">
        <div class="page-hd-label">${esc(label)}</div>
        <div class="page-hd-name">${esc(name)}</div>
        ${meta ? `<div class="page-hd-meta">${esc(meta)}</div>` : '<div class="page-hd-meta"></div>'}
      </div>
    </div>`;
  }

  window.IRIS = window.IRIS || {};
  window.IRIS.pageHeader = pageHeader;
})();
