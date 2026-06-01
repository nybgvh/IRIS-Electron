/*
 * Project tab.
 *
 * Three sections, stacked:
 *   1. Active project — details (name, description, members) of whatever
 *      is currently selected in session. Editable by owners.
 *   2. Your projects — list of every project the user is a member of,
 *      clickable to switch active. Click → updates session.currentProject;
 *      every other tab reacts.
 *   3. Create new project — form. Created project is auto-selected as
 *      active and the user lands on its detail card.
 *
 * Project is the "entry point" — when a user has no projects at all, this
 * tab is the only place they can do anything useful. The other tabs render
 * a "select a project" empty state until one exists and is active.
 */

(function () {
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
    }[c]));
  }

  function fmtDate(s) {
    if (!s) return '—';
    // SQLite datetime('now') gives 'YYYY-MM-DD HH:MM:SS' (UTC). Render as-is.
    return String(s).replace('T', ' ').replace('Z', ' UTC');
  }

  // -------------------------------------------------------------------------
  // network
  // -------------------------------------------------------------------------
  async function refresh() {
    await window.IRIS.session.loadProjects();
  }

  async function createProject({ name, description }) {
    const created = await window.IRIS.api.projects.create({ name, description });
    await refresh();
    window.IRIS.session.setCurrentProject(created.id);
    window.IRIS.toast(`Created project "${created.name}".`);
  }

  async function updateProject(id, patch) {
    await window.IRIS.api.projects.update(id, patch);
    await refresh();
    window.IRIS.toast('Project saved.');
  }

  async function deleteProject(id) {
    if (!confirm('Archive this project? Sources, VoucherVision records, and assessments stay in the database but the project is removed from your active list.')) return;
    await window.IRIS.api.projects.delete(id);
    await refresh();
    window.IRIS.toast('Project archived.');
  }

  // -------------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------------
  let container = null;

  function render() {
    if (!container) return;
    const projects = window.IRIS.session.getProjects();
    const active = window.IRIS.session.getCurrentProject();
    const user = window.IRIS.session.get();

    container.innerHTML = `
      <div class="page-toolbar">
        <span class="title">Project</span>
        <span class="subtitle">— context for every other tab</span>
        <div class="spacer"></div>
        <span class="phase beta">Phase 0</span>
      </div>

      <div class="page-body">
        ${active ? renderActive(active, user) : renderNoActive(projects.length)}

        <div class="project-section">
          <div class="project-section-head">
            <h3>Your projects</h3>
            <span class="project-section-count">${projects.length} project${projects.length === 1 ? '' : 's'}</span>
          </div>
          ${projects.length === 0
            ? `<div class="project-empty">You aren't a member of any project yet. Create one below.</div>`
            : `<div class="project-list">
                ${projects.map(p => renderListItem(p, active && p.id === active.id)).join('')}
              </div>`
          }
        </div>

        ${renderCreateForm()}
      </div>
    `;

    wireEvents();
  }

  function renderActive(p, user) {
    const isOwner = canEdit(p, user);
    return `
      <div class="project-active card">
        <div class="project-active-head">
          <div>
            <div class="project-active-eyebrow">Active project</div>
            <h2 class="project-active-name" id="proj-name-display">${escapeHtml(p.name)}</h2>
          </div>
          <div class="project-active-actions">
            ${isOwner ? `<button class="btn ghost sm" data-act="edit-active">Edit</button>` : ''}
            ${isOwner ? `<button class="btn danger sm" data-act="delete-active">Archive</button>` : ''}
          </div>
        </div>

        <div class="project-active-meta">
          <div><span class="meta-label">ID</span> <span class="mono">#${p.id}</span></div>
          <div><span class="meta-label">Created</span> ${escapeHtml(fmtDate(p.created_at))}</div>
          <div><span class="meta-label">Updated</span> ${escapeHtml(fmtDate(p.updated_at))}</div>
        </div>

        <div class="project-active-desc" id="proj-desc-display">
          ${p.description ? escapeHtml(p.description) : '<span class="muted">No description.</span>'}
        </div>

        <div class="project-edit hidden" id="proj-edit">
          <div class="form-row">
            <div>
              <label class="field-label">Name</label>
              <input class="input" id="proj-edit-name" value="${escapeHtml(p.name)}" />
            </div>
          </div>
          <div class="form-row cols-1">
            <div>
              <label class="field-label">Description</label>
              <textarea class="textarea" id="proj-edit-desc" rows="3">${escapeHtml(p.description || '')}</textarea>
            </div>
          </div>
          <div class="project-edit-actions">
            <button class="btn ghost sm" data-act="edit-cancel">Cancel</button>
            <button class="btn sm" data-act="edit-save">Save</button>
          </div>
        </div>

        <div class="project-members" id="proj-members">
          <div class="project-section-head">
            <h4>Members</h4>
            <span class="project-section-count" id="proj-members-count"></span>
          </div>
          <div class="project-members-list" id="proj-members-list">
            <div class="muted small">Loading…</div>
          </div>
          ${isOwner ? `
            <div class="project-members-add" id="proj-members-add">
              <select class="select" id="add-member-user">
                <option value="">Loading teammates…</option>
              </select>
              <select class="select" id="add-member-role">
                <option value="editor" selected>Editor</option>
                <option value="uploader">Uploader</option>
                <option value="owner">Owner</option>
              </select>
              <button class="btn sm" id="add-member-btn">Add member</button>
            </div>
            <div class="muted small project-members-hint" id="add-member-hint">
              Pick a teammate to add. Editors can upload and edit assessments;
              uploaders can only upload sources; owners can additionally manage members.
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  function renderNoActive(projectCount) {
    return `
      <div class="project-active card project-active-empty">
        <div class="page-empty">
          <div class="glyph">◆</div>
          <h2>No project selected</h2>
          <p>
            ${projectCount === 0
              ? 'Create your first project below to start uploading sources and drafting assessments.'
              : 'Pick one of your projects below to set it as the working context. Sources, Geography, Assessment, and References are all scoped to the active project.'}
          </p>
        </div>
      </div>
    `;
  }

  function renderListItem(p, isActive) {
    return `
      <div class="project-list-item ${isActive ? 'active' : ''}" data-pid="${p.id}">
        <div class="project-list-item-body">
          <div class="project-list-item-name">${escapeHtml(p.name)}</div>
          <div class="project-list-item-desc">${escapeHtml(p.description || '—')}</div>
          <div class="project-list-item-meta mono small">
            id #${p.id} · updated ${escapeHtml(fmtDate(p.updated_at))}
          </div>
        </div>
        <div class="project-list-item-actions">
          ${isActive
            ? `<span class="phase beta">Active</span>`
            : `<button class="btn ghost sm" data-act="select" data-pid="${p.id}">Open</button>`
          }
        </div>
      </div>
    `;
  }

  function renderCreateForm() {
    return `
      <div class="project-section">
        <div class="project-section-head">
          <h3>Create a project</h3>
        </div>
        <div class="card">
          <div class="form-row">
            <div>
              <label class="field-label">Name</label>
              <input class="input" id="new-proj-name" placeholder="e.g. Magnoliaceae Red List 2026" />
            </div>
            <div>
              <label class="field-label">Description (optional)</label>
              <input class="input" id="new-proj-desc" placeholder="One-line purpose" />
            </div>
          </div>
          <div class="project-create-actions">
            <button class="btn" id="new-proj-create">Create project</button>
          </div>
        </div>
      </div>
    `;
  }

  // -------------------------------------------------------------------------
  // wiring
  // -------------------------------------------------------------------------
  function canEdit(project, user) {
    if (!project || !user) return false;
    if (user.role === 'admin') return true;
    return project.owner_id === user.id;
  }

  function wireEvents() {
    // open project
    container.querySelectorAll('[data-act="select"]').forEach(b => {
      b.addEventListener('click', () => {
        window.IRIS.session.setCurrentProject(Number(b.dataset.pid));
      });
    });
    container.querySelectorAll('.project-list-item').forEach(el => {
      el.addEventListener('click', (e) => {
        // Don't double-fire if they clicked the explicit button.
        if (e.target.closest('button')) return;
        const pid = Number(el.dataset.pid);
        if (pid) window.IRIS.session.setCurrentProject(pid);
      });
    });

    // edit / archive active project
    const editBtn = container.querySelector('[data-act="edit-active"]');
    if (editBtn) editBtn.addEventListener('click', () => {
      container.querySelector('#proj-edit').classList.remove('hidden');
    });
    const cancelBtn = container.querySelector('[data-act="edit-cancel"]');
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      container.querySelector('#proj-edit').classList.add('hidden');
    });
    const saveBtn = container.querySelector('[data-act="edit-save"]');
    if (saveBtn) saveBtn.addEventListener('click', async () => {
      const active = window.IRIS.session.getCurrentProject();
      if (!active) return;
      const name = container.querySelector('#proj-edit-name').value.trim();
      const description = container.querySelector('#proj-edit-desc').value;
      if (!name) { window.IRIS.toast('Name is required.', 'error'); return; }
      try {
        await updateProject(active.id, { name, description });
      } catch (err) {
        window.IRIS.toast(err.message || 'Save failed.', 'error');
      }
    });
    const delBtn = container.querySelector('[data-act="delete-active"]');
    if (delBtn) delBtn.addEventListener('click', async () => {
      const active = window.IRIS.session.getCurrentProject();
      if (!active) return;
      try {
        await deleteProject(active.id);
      } catch (err) {
        window.IRIS.toast(err.message || 'Archive failed.', 'error');
      }
    });

    // create
    const createBtn = container.querySelector('#new-proj-create');
    if (createBtn) createBtn.addEventListener('click', async () => {
      const name = container.querySelector('#new-proj-name').value.trim();
      const description = container.querySelector('#new-proj-desc').value.trim();
      if (!name) { window.IRIS.toast('Project name is required.', 'error'); return; }
      try {
        await createProject({ name, description });
        container.querySelector('#new-proj-name').value = '';
        container.querySelector('#new-proj-desc').value = '';
      } catch (err) {
        window.IRIS.toast(err.message || 'Create failed.', 'error');
      }
    });

    // members
    loadMembers();
  }

  const ROLE_OPTIONS = ['owner', 'editor', 'uploader'];

  function renderMemberRow(m, project, canManage) {
    const ownerLocked = Number(m.user_id) === Number(project.owner_id);
    const initial = (m.display_name || m.email || '?').slice(0, 1).toUpperCase();

    const roleControl = canManage && !ownerLocked
      ? `<select class="select sm member-role-select" data-uid="${m.user_id}">
           ${ROLE_OPTIONS.map(r =>
             `<option value="${r}" ${m.role === r ? 'selected' : ''}>${r}</option>`
           ).join('')}
         </select>`
      : `<span class="role-pill role-${escapeHtml(m.role)}" title="${ownerLocked ? 'Project creator — role locked' : ''}">${escapeHtml(m.role)}</span>`;

    const removeBtn = canManage && !ownerLocked
      ? `<button class="btn danger sm member-remove" data-uid="${m.user_id}" title="Remove from project">Remove</button>`
      : '';

    return `
      <div class="member-row" data-uid="${m.user_id}">
        <div class="member-avatar">${escapeHtml(initial)}</div>
        <div class="member-info">
          <div class="member-name">${escapeHtml(m.display_name || m.email)}</div>
          <div class="member-email mono small">${escapeHtml(m.email)}</div>
        </div>
        ${roleControl}
        ${removeBtn}
      </div>
    `;
  }

  async function loadMembers() {
    const active = window.IRIS.session.getCurrentProject();
    if (!active) return;
    const user = window.IRIS.session.get();
    const canManage = canEdit(active, user);

    const listEl  = container.querySelector('#proj-members-list');
    const countEl = container.querySelector('#proj-members-count');
    if (!listEl) return;

    try {
      const members = await window.IRIS.api.members.list(active.id);
      if (countEl) countEl.textContent = `${members.length} member${members.length === 1 ? '' : 's'}`;
      listEl.innerHTML = members.length
        ? members.map(m => renderMemberRow(m, active, canManage)).join('')
        : `<div class="muted small">No members.</div>`;
      wireMemberControls(active.id);
    } catch (err) {
      listEl.innerHTML = `<div class="muted small">Could not load members: ${escapeHtml(err.message)}</div>`;
    }

    wireAddMemberForm(active.id);
  }

  function wireMemberControls(projectId) {
    // Role change → fires immediately on select.
    container.querySelectorAll('.member-role-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        const userId = Number(sel.dataset.uid);
        const role = sel.value;
        try {
          await window.IRIS.api.members.updateRole(projectId, userId, role);
          window.IRIS.toast(`Role updated to ${role}.`);
          loadMembers();
        } catch (err) {
          window.IRIS.toast(err.message || 'Could not update role.', 'error');
          loadMembers(); // revert UI
        }
      });
    });

    // Remove → confirm + call.
    container.querySelectorAll('.member-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = Number(btn.dataset.uid);
        if (!confirm('Remove this user from the project? They lose access to all sources, VoucherVision records, and assessments scoped to this project.')) return;
        try {
          await window.IRIS.api.members.remove(projectId, userId);
          window.IRIS.toast('Member removed.');
          loadMembers();
        } catch (err) {
          window.IRIS.toast(err.message || 'Could not remove member.', 'error');
        }
      });
    });
  }

  async function wireAddMemberForm(projectId) {
    const btn = container.querySelector('#add-member-btn');
    if (!btn) return; // not an owner; no form rendered
    const userSelect = container.querySelector('#add-member-user');
    const roleEl     = container.querySelector('#add-member-role');
    const hintEl     = container.querySelector('#add-member-hint');

    // Populate the teammate dropdown, filtered to exclude users already in
    // this project. The list comes from the caller's team (server-side).
    try {
      const [teammates, members] = await Promise.all([
        window.IRIS.api.teams.myTeammates(),
        window.IRIS.api.members.list(projectId),
      ]);
      const existingIds = new Set(members.map(m => Number(m.user_id)));
      const available = teammates.filter(u => !existingIds.has(Number(u.id)));

      if (available.length === 0) {
        userSelect.innerHTML = `<option value="">No teammates available</option>`;
        userSelect.disabled = true;
        btn.disabled = true;
        if (hintEl) {
          hintEl.textContent = teammates.length === 0
            ? 'Your team has no other members. Ask an admin to add someone to your team, or use Admin Tools yourself.'
            : 'Everyone on your team is already a member of this project.';
        }
      } else {
        userSelect.disabled = false;
        btn.disabled = false;
        userSelect.innerHTML = `<option value="">Pick a teammate…</option>` +
          available.map(u => `
            <option value="${u.id}">${escapeHtml(u.display_name || u.email)} — ${escapeHtml(u.email)}</option>
          `).join('');
      }
    } catch (err) {
      userSelect.innerHTML = `<option value="">Could not load teammates</option>`;
      userSelect.disabled = true;
      btn.disabled = true;
      window.IRIS.toast(`Could not load teammates: ${err.message}`, 'error');
    }

    const submit = async () => {
      const userId = Number(userSelect.value || 0);
      const role   = roleEl.value;
      if (!userId) { window.IRIS.toast('Pick a teammate first.', 'error'); return; }
      btn.disabled = true;
      try {
        await window.IRIS.api.members.add(projectId, { user_id: userId, role });
        window.IRIS.toast(`Added as ${role}.`);
        loadMembers(); // also re-runs wireAddMemberForm, refreshing the dropdown
      } catch (err) {
        window.IRIS.toast(err.message || 'Could not add member.', 'error');
        btn.disabled = false;
      }
    };

    btn.addEventListener('click', submit);
  }

  // -------------------------------------------------------------------------
  // entry
  //
  // No per-page subscription to session.onProjectChange — the router owns
  // that single subscription and calls mount() again when the active tab is
  // Project and the project changes. Multiple subscribers used to fight
  // over #app-main on a switch and briefly flash the wrong tab's content.
  // -------------------------------------------------------------------------
  function mount(node) {
    container = node;
    render();
  }

  function placeholder(node, opts) {
    // Used by Sources/Geography/Assessment/References as their "no project"
    // empty state. Kept here so all five tabs share one renderer.
    node.innerHTML = `
      <div class="page-toolbar">
        <span class="title">${escapeHtml(opts.title)}</span>
        <span class="subtitle">— ${escapeHtml(opts.subtitle)}</span>
        <div class="spacer"></div>
        <span class="phase beta">Phase 0</span>
      </div>
      <div class="page-body">
        <div class="page-empty">
          <div class="glyph">${opts.glyph || '◆'}</div>
          <h2>${escapeHtml(opts.title)}</h2>
          <p>${opts.body}</p>
        </div>
      </div>
    `;
  }

  function noProjectPlaceholder(node, opts) {
    node.innerHTML = `
      <div class="page-toolbar">
        <span class="title">${escapeHtml(opts.title)}</span>
        <span class="subtitle">— ${escapeHtml(opts.subtitle)}</span>
        <div class="spacer"></div>
        <span class="phase beta">No project</span>
      </div>
      <div class="page-body">
        <div class="page-empty">
          <div class="glyph">◆</div>
          <h2>Select a project first</h2>
          <p>
            ${escapeHtml(opts.title)} is scoped to a project. Open the
            <strong>Project</strong> tab to choose or create one, or use the
            project switcher in the top bar.
          </p>
          <p style="margin-top:14px;">
            <button class="btn" data-go-project>Go to Project tab</button>
          </p>
        </div>
      </div>
    `;
    const btn = node.querySelector('[data-go-project]');
    if (btn) btn.addEventListener('click', () => {
      const tab = document.querySelector('.tab[data-tab="project"]');
      if (tab) tab.click();
    });
  }

  window.IRIS = window.IRIS || {};
  window.IRIS.ProjectPage = { mount, placeholder, noProjectPlaceholder };
})();
