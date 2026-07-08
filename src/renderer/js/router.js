/*
 * Tiny router. Two top-level routes — "login" and "app" — chosen by whether
 * a current user exists. Within "app", the active tab id is the sub-route.
 * Future migration to history-API or hash routing happens here only.
 */

(function () {
  const PAGES = {
    project:    () => window.IRIS.ProjectPage,
    sources:    () => window.IRIS.SourcesPage,
    geography:  () => window.IRIS.GeographyPage,
    assessment: () => window.IRIS.AssessmentPage,
    gbif:       () => window.IRIS.GbifPage,
    references: () => window.IRIS.ReferencesPage,
  };

  // Single project-change subscription held at module scope. Re-attached
  // on each renderApp() — but the previous one is detached first so we
  // never end up with two listeners trying to re-mount tabs at once
  // across a login/logout cycle.
  let unsubscribeProject = null;

  function renderLogin() {
    const root = document.getElementById('root');
    root.innerHTML = '';
    window.IRIS.LoginPage.mount(root);
  }

  async function renderApp(user) {
    const root = document.getElementById('root');
    root.innerHTML = '';
    window.IRIS.Topbar.mount(root, user, {
      onUserClick: () => window.IRIS.SettingsDialog.open(user, {
        onLogout: async () => {
          await window.IRIS.session.logout();
        },
      }),
    });

    // Fetch the user's projects BEFORE mounting tabs so the switcher chip
    // and the first tab render with the right active context.
    try { await window.IRIS.session.loadProjects(); }
    catch (err) { window.IRIS.toast(`Could not load projects: ${err.message}`, 'error'); }

    window.IRIS.Tabs.mount(root, {
      initial: 'project',
      onChange: (id) => {
        const main = document.getElementById('app-main');
        const page = PAGES[id] && PAGES[id]();
        if (page) page.mount(main);
      },
    });
    root.insertAdjacentHTML('beforeend', `
      <footer class="app-footer">
        <strong>IRIS</strong> · The New York Botanical Garden · Phase 0 Beta
      </footer>
    `);

    // When the active project changes, re-render whichever tab is currently
    // visible so its data refreshes against the new context.
    if (unsubscribeProject) unsubscribeProject();
    unsubscribeProject = window.IRIS.session.onProjectChange(() => {
      const activeTab = document.querySelector('.tab.active');
      if (!activeTab) return;
      const id = activeTab.dataset.tab;
      const main = document.getElementById('app-main');
      if (!main) return;
      const page = PAGES[id] && PAGES[id]();
      if (page) page.mount(main);
    });
  }

  function boot() {
    const user = window.IRIS.session.get();
    if (user) renderApp(user); else renderLogin();
  }

  window.IRIS = window.IRIS || {};
  window.IRIS.router = { boot, renderLogin, renderApp };
})();
