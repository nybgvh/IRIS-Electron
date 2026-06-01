/*
 * Project switcher — a chip in the topbar that shows the active project
 * name and opens a dropdown to switch projects or jump to the Project tab
 * to create / manage them.
 *
 * Subscribes to session.onProjectChange so the chip stays in sync if the
 * Project tab edits or deletes the active project.
 */

(function () {
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
    }[c]));
  }

  let unsubscribe = null;
  let outsideHandler = null;

  function close(container) {
    const menu = container.querySelector('.project-switcher-menu');
    if (menu) menu.classList.remove('open');
    if (outsideHandler) {
      document.removeEventListener('mousedown', outsideHandler);
      outsideHandler = null;
    }
  }

  function open(container) {
    const menu = container.querySelector('.project-switcher-menu');
    if (!menu) return;
    menu.classList.add('open');
    outsideHandler = (e) => {
      if (!container.contains(e.target)) close(container);
    };
    setTimeout(() => document.addEventListener('mousedown', outsideHandler), 0);
  }

  function render(container) {
    const active = window.IRIS.session.getCurrentProject();
    const projects = window.IRIS.session.getProjects();

    const chipLabel = active ? active.name : (projects.length ? 'Select project…' : 'No projects yet');
    const chipMutedClass = active ? '' : 'muted';

    container.innerHTML = `
      <button class="project-switcher-chip ${chipMutedClass}" type="button" aria-haspopup="true">
        <span class="project-switcher-tag">Project</span>
        <span class="project-switcher-name">${escapeHtml(chipLabel)}</span>
        <span class="project-switcher-caret">▾</span>
      </button>
      <div class="project-switcher-menu" role="menu">
        ${projects.length === 0
          ? `<div class="project-switcher-empty">No projects yet.</div>`
          : projects.map(p => `
              <button class="project-switcher-item ${active && p.id === active.id ? 'active' : ''}"
                      type="button" data-pid="${p.id}" role="menuitem">
                <span class="project-switcher-item-name">${escapeHtml(p.name)}</span>
                ${p.description ? `<span class="project-switcher-item-desc">${escapeHtml(p.description)}</span>` : ''}
              </button>
            `).join('')
        }
        <div class="project-switcher-sep"></div>
        <button class="project-switcher-item" type="button" data-action="manage" role="menuitem">
          <span class="project-switcher-item-name">Manage projects…</span>
          <span class="project-switcher-item-desc">Create, edit, members</span>
        </button>
      </div>
    `;

    const chip = container.querySelector('.project-switcher-chip');
    const menu = container.querySelector('.project-switcher-menu');

    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.classList.contains('open')) close(container);
      else open(container);
    });

    container.querySelectorAll('.project-switcher-item[data-pid]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.pid);
        window.IRIS.session.setCurrentProject(id);
        close(container);
      });
    });
    const manage = container.querySelector('[data-action="manage"]');
    if (manage) {
      manage.addEventListener('click', () => {
        close(container);
        // Switch to the Project tab.
        const projectTab = document.querySelector('.tab[data-tab="project"]');
        if (projectTab) projectTab.click();
      });
    }
  }

  function mount(container) {
    render(container);
    // Re-render the chip whenever the active project or project list changes.
    if (unsubscribe) unsubscribe();
    unsubscribe = window.IRIS.session.onProjectChange(() => render(container));
  }

  window.IRIS = window.IRIS || {};
  window.IRIS.ProjectSwitcher = { mount };
})();
