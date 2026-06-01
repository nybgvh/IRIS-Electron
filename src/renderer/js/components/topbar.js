(function () {
  function initials(name, email) {
    const src = (name || email || '?').trim();
    const parts = src.split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return src.slice(0, 2).toUpperCase();
  }

  function render(user) {
    const tag = initials(user.display_name, user.email);
    return `
      <header class="topbar">
        <div class="topbar-inner">
          <div class="brand">
            <span class="brand-iris">IRIS</span>
            <span class="brand-tagline">IUCN Red List<br/>Information System</span>
          </div>
          <div class="topbar-spacer"></div>

          <a class="brand-nybg" href="https://www.nybg.org/" target="_blank" rel="noopener noreferrer"
             aria-label="The New York Botanical Garden">
            <div class="brand-nybg-from">a project of</div>
            <span class="brand-nybg-mark">NYBG</span>
          </a>

          <div class="brand-divider-v"></div>

          <div class="topbar-actions">
            ${user.role === 'admin' ? `
              <button class="topbar-admin-btn" id="admin-tools-btn" title="Admin Tools — manage users, teams, and projects">
                <span class="topbar-admin-glyph">⚙</span>
                Admin Tools
              </button>
            ` : ''}
            <div class="project-switcher" id="project-switcher"></div>
            <button class="user-chip" id="user-chip">
              <span class="avatar">${tag}</span>
              <span>${user.display_name || user.email}</span>
            </button>
          </div>
        </div>
      </header>
    `;
  }

  function mount(root, user, { onUserClick }) {
    root.insertAdjacentHTML('beforeend', render(user));
    const chip = root.querySelector('#user-chip');
    if (chip && onUserClick) chip.addEventListener('click', onUserClick);
    const switcher = root.querySelector('#project-switcher');
    if (switcher) window.IRIS.ProjectSwitcher.mount(switcher);
    const adminBtn = root.querySelector('#admin-tools-btn');
    if (adminBtn) {
      adminBtn.addEventListener('click', () => window.IRIS.AdminDashboard.open(user));
    }
  }

  window.IRIS = window.IRIS || {};
  window.IRIS.Topbar = { mount };
})();
