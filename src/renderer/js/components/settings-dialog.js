(function () {
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
    }[c]));
  }

  function html(user, updaterInfo) {
    return `
      <div class="modal-backdrop show" id="settings-backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <div class="modal-head">
            <h2 id="settings-title">Settings &amp; Preferences</h2>
            <div class="spacer"></div>
            <button class="modal-close" id="settings-close" aria-label="Close">&times;</button>
          </div>
          <div class="modal-body">
            <section>
              <h3 style="font-size:13px;letter-spacing:1.2px;text-transform:uppercase;color:var(--nybg-muted);margin-bottom:8px;">Profile</h3>
              <div class="row">
                <span class="label">Name</span>
                <span class="value">${escapeHtml(user.display_name || '—')}</span>
              </div>
              <div class="row">
                <span class="label">Email</span>
                <span class="value mono">${escapeHtml(user.email)}</span>
              </div>
              <div class="row">
                <span class="label">Role</span>
                <span class="value">${escapeHtml(user.role)}</span>
              </div>
            </section>

            <section style="margin-top:18px;">
              <h3 style="font-size:13px;letter-spacing:1.2px;text-transform:uppercase;color:var(--nybg-muted);margin-bottom:8px;">Updates</h3>
              <div class="row">
                <span class="label">IRIS version</span>
                <span class="value mono">${escapeHtml(updaterInfo.version || '?')}</span>
              </div>
              <div class="row">
                <span class="label">Platform</span>
                <span class="value mono">${escapeHtml(updaterInfo.platform || '?')}</span>
              </div>
              <div class="row">
                <span class="label">Mode</span>
                <span class="value">${updaterInfo.packaged ? 'Packaged' : 'Development'}</span>
              </div>
              <div class="row">
                <button class="btn ghost sm" id="settings-check-update">Check for updates</button>
                <span class="value" id="settings-update-status">—</span>
              </div>
            </section>
          </div>
          <div class="modal-foot">
            <button class="btn danger sm" id="settings-logout">Log out</button>
            <button class="btn sm" id="settings-done">Done</button>
          </div>
        </div>
      </div>
    `;
  }

  async function open(user, { onLogout } = {}) {
    const root = document.getElementById('modal-root');
    let info = { version: '?', platform: '?', packaged: false };
    try { info = await window.IRIS.api.updater.info(); } catch (_) {}
    root.innerHTML = html(user, info);

    const close = () => { root.innerHTML = ''; };
    root.querySelector('#settings-close').addEventListener('click', close);
    root.querySelector('#settings-done').addEventListener('click', close);
    root.querySelector('#settings-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'settings-backdrop') close();
    });

    root.querySelector('#settings-logout').addEventListener('click', async () => {
      close();
      if (onLogout) onLogout();
    });

    const statusEl = root.querySelector('#settings-update-status');
    root.querySelector('#settings-check-update').addEventListener('click', async () => {
      statusEl.textContent = 'Checking…';
      try {
        const res = await window.IRIS.api.updater.check();
        if (res && res.dev) statusEl.textContent = 'Dev build — updates disabled';
        else statusEl.textContent = 'Check started';
      } catch (err) {
        statusEl.textContent = 'Error: ' + (err.message || 'failed');
      }
    });
  }

  window.IRIS = window.IRIS || {};
  window.IRIS.SettingsDialog = { open };
})();
