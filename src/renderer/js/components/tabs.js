(function () {
  const TABS = [
    { id: 'project',     label: 'Project' },
    { id: 'sources',     label: 'Library' },
    { id: 'geography',   label: 'Geography' },
    { id: 'assessment',  label: 'Assessment' },
    { id: 'gbif',        label: 'GBIF' },
    { id: 'references',  label: 'References' },
  ];

  function render(activeId) {
    return `
      <nav class="tabs">
        <div class="tabs-inner">
          ${TABS.map(t => `
            <button class="tab ${t.id === activeId ? 'active' : ''}" data-tab="${t.id}">
              ${t.label}
            </button>
          `).join('')}
        </div>
      </nav>
      <main class="app-main" id="app-main"></main>
    `;
  }

  function mount(root, { initial = 'project', onChange } = {}) {
    root.insertAdjacentHTML('beforeend', render(initial));
    const buttons = root.querySelectorAll('.tab');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.toggle('active', b === btn));
        const id = btn.dataset.tab;
        if (onChange) onChange(id);
      });
    });
    if (onChange) onChange(initial);
  }

  window.IRIS = window.IRIS || {};
  window.IRIS.Tabs = { mount, TABS };
})();
