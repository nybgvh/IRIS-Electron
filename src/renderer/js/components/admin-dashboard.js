/*
 * Admin Tools modal — a full-bleed dashboard for global admins. Four tabs:
 *
 *   Stats     — counts pulled from admin:stats
 *   Users     — full user CRUD: create, change role, change team, delete
 *   Teams     — team CRUD + expandable member lists
 *   Projects  — every project across the system with archive/restore
 *
 * Renders into #modal-root and reuses the .modal-backdrop overlay pattern.
 * Single instance — open() replaces any existing content.
 */

(function () {
  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
    }[c]));
  }
  function fmtDate(s) {
    if (!s) return '—';
    return String(s).replace('T', ' ').replace('Z', ' UTC');
  }
  function toast(msg, type) {
    if (window.IRIS && window.IRIS.toast) window.IRIS.toast(msg, type);
  }
  function api() { return window.IRIS.api; }

  // -------------------------------------------------------------------------
  // module state — survives between tab clicks but is cleared on close()
  // -------------------------------------------------------------------------
  const state = {
    open: false,
    activeTab: 'stats',
    cache: {
      stats: null,
      users: null,
      teams: null,
      projects: null,
    },
  };

  // -------------------------------------------------------------------------
  // shell
  // -------------------------------------------------------------------------
  const TABS = [
    { id: 'stats',    label: 'Stats' },
    { id: 'users',    label: 'Users' },
    { id: 'teams',    label: 'Teams' },
    { id: 'projects', label: 'Projects' },
  ];

  function renderShell() {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-backdrop show" id="admin-backdrop">
        <div class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-title">
          <div class="admin-head">
            <h2 id="admin-title">Admin Tools</h2>
            <span class="phase beta" style="background: rgba(253, 200, 47, 0.18); color: #6a5a1d; border: 1px solid var(--iucn-yellow);">
              Global admin
            </span>
            <div class="spacer"></div>
            <button class="modal-close" id="admin-close" aria-label="Close">&times;</button>
          </div>
          <div class="admin-tabs">
            ${TABS.map(t => `
              <button class="admin-tab ${state.activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">
                ${t.label}
              </button>
            `).join('')}
          </div>
          <div class="admin-body" id="admin-body"></div>
        </div>
      </div>
    `;

    root.querySelector('#admin-close').addEventListener('click', close);
    root.querySelector('#admin-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'admin-backdrop') close();
    });
    root.querySelectorAll('.admin-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        root.querySelectorAll('.admin-tab').forEach(b => b.classList.toggle('active', b === btn));
        state.activeTab = btn.dataset.tab;
        renderActiveTab();
      });
    });
  }

  function renderActiveTab() {
    const body = document.getElementById('admin-body');
    if (!body) return;
    body.innerHTML = '<div class="muted small">Loading…</div>';
    if (state.activeTab === 'stats')    return renderStats(body);
    if (state.activeTab === 'users')    return renderUsers(body);
    if (state.activeTab === 'teams')    return renderTeams(body);
    if (state.activeTab === 'projects') return renderProjects(body);
  }

  // -------------------------------------------------------------------------
  // STATS
  // -------------------------------------------------------------------------
  async function renderStats(body) {
    try {
      const stats = await api().admin.stats();
      state.cache.stats = stats;
      const cards = [
        { label: 'Users',                value: stats.users },
        { label: 'Teams',                value: stats.teams },
        { label: 'Active projects',      value: stats.projects },
        { label: 'Archived projects',    value: stats.archived,      hint: 'soft-deleted' },
        { label: 'Sources',              value: stats.sources,       hint: 'uploaded files' },
        { label: 'VoucherVision records',value: stats.vouchervision, hint: 'JSON records' },
        { label: 'Assessments',          value: stats.assessments,   hint: 'Red List drafts' },
      ];
      body.innerHTML = `
        <div class="admin-section-head">
          <h3>Totals</h3>
          <span class="small">Snapshot of the database</span>
        </div>
        <div class="stat-grid">
          ${cards.map(c => `
            <div class="stat-card">
              <div class="stat-label">${escapeHtml(c.label)}</div>
              <div class="stat-value">${c.value}</div>
              ${c.hint ? `<div class="stat-hint">${escapeHtml(c.hint)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      `;
    } catch (err) {
      body.innerHTML = `<div class="muted small">Could not load stats: ${escapeHtml(err.message)}</div>`;
    }
  }

  // -------------------------------------------------------------------------
  // USERS
  // -------------------------------------------------------------------------
  async function renderUsers(body) {
    try {
      const [users, teams] = await Promise.all([api().users.list(), api().teams.list()]);
      state.cache.users = users;
      state.cache.teams = teams;
      const teamOptions = (selectedId) =>
        `<option value="">(none)</option>` +
        teams.map(t => `<option value="${t.id}" ${selectedId === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('');
      const roleOptions = (selectedRole) =>
        ['admin', 'member'].map(r =>
          `<option value="${r}" ${selectedRole === r ? 'selected' : ''}>${r}</option>`
        ).join('');

      body.innerHTML = `
        <div class="admin-section-head">
          <h3>Users</h3>
          <span class="small">${users.length} total</span>
        </div>

        <form class="admin-create" id="new-user-form">
          <div class="field grow"><label class="field-label">Name</label><input class="input" name="display_name" required /></div>
          <div class="field grow"><label class="field-label">Email</label><input class="input" name="email" type="email" required /></div>
          <div class="field"><label class="field-label">Password</label><input class="input" name="password" type="text" value="1234" required /></div>
          <div class="field"><label class="field-label">Role</label><select class="select" name="role">${roleOptions('member')}</select></div>
          <div class="field"><label class="field-label">Team</label><select class="select" name="team_id">${teamOptions(null)}</select></div>
          <button class="btn sm" type="submit">Add user</button>
        </form>

        <table class="admin-table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Global role</th><th>Team</th><th>Last login</th><th></th></tr>
          </thead>
          <tbody>
            ${users.map(u => `
              <tr data-uid="${u.id}">
                <td>${escapeHtml(u.display_name || '—')}</td>
                <td><span class="mono">${escapeHtml(u.email)}</span></td>
                <td>
                  <select class="select sm" data-act="role" data-uid="${u.id}">
                    ${roleOptions(u.role)}
                  </select>
                </td>
                <td>
                  <select class="select sm" data-act="team" data-uid="${u.id}">
                    ${teamOptions(u.team_id)}
                  </select>
                </td>
                <td class="mono">${escapeHtml(u.last_login_at || '—')}</td>
                <td class="row-actions">
                  <button class="btn danger sm" data-act="delete" data-uid="${u.id}">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      // create
      body.querySelector('#new-user-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const payload = {
          display_name: fd.get('display_name'),
          email:        fd.get('email'),
          password:     fd.get('password'),
          role:         fd.get('role'),
          team_id:      fd.get('team_id') ? Number(fd.get('team_id')) : null,
        };
        try {
          await api().users.create(payload);
          toast(`Created ${payload.email}.`);
          renderUsers(body);
        } catch (err) {
          toast(err.message || 'Create failed.', 'error');
        }
      });

      // role + team changes
      body.querySelectorAll('select[data-act="role"]').forEach(sel => {
        sel.addEventListener('change', async () => {
          const id = Number(sel.dataset.uid);
          try {
            await api().users.update(id, { role: sel.value });
            toast(`Role updated to ${sel.value}.`);
          } catch (err) {
            toast(err.message || 'Could not update role.', 'error');
            renderUsers(body);
          }
        });
      });
      body.querySelectorAll('select[data-act="team"]').forEach(sel => {
        sel.addEventListener('change', async () => {
          const id = Number(sel.dataset.uid);
          const team_id = sel.value ? Number(sel.value) : null;
          try {
            await api().users.update(id, { team_id });
            toast(team_id ? 'Team assignment updated.' : 'Removed from team.');
          } catch (err) {
            toast(err.message || 'Could not update team.', 'error');
            renderUsers(body);
          }
        });
      });
      body.querySelectorAll('button[data-act="delete"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.uid);
          if (!confirm('Delete this user? Their project memberships and source uploads remain in the database (uploaded_by becomes NULL).')) return;
          try {
            await api().users.delete(id);
            toast('User deleted.');
            renderUsers(body);
          } catch (err) {
            toast(err.message || 'Delete failed.', 'error');
          }
        });
      });
    } catch (err) {
      body.innerHTML = `<div class="muted small">Could not load users: ${escapeHtml(err.message)}</div>`;
    }
  }

  // -------------------------------------------------------------------------
  // TEAMS
  // -------------------------------------------------------------------------
  async function renderTeams(body) {
    try {
      const teams = await api().teams.list();
      state.cache.teams = teams;
      body.innerHTML = `
        <div class="admin-section-head">
          <h3>Teams</h3>
          <span class="small">${teams.length} total</span>
        </div>

        <form class="admin-create" id="new-team-form">
          <div class="field grow"><label class="field-label">Team name</label><input class="input" name="name" required /></div>
          <div class="field grow"><label class="field-label">Description</label><input class="input" name="description" /></div>
          <button class="btn sm" type="submit">Add team</button>
        </form>

        <div id="team-list">
          ${teams.length === 0
            ? `<div class="muted small">No teams yet.</div>`
            : teams.map(renderTeamCard).join('')
          }
        </div>
      `;

      // create
      body.querySelector('#new-team-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api().teams.create({
            name: fd.get('name'),
            description: fd.get('description'),
          });
          toast('Team created.');
          renderTeams(body);
        } catch (err) {
          toast(err.message || 'Create failed.', 'error');
        }
      });

      // each card
      body.querySelectorAll('.team-card').forEach(card => wireTeamCard(card));
    } catch (err) {
      body.innerHTML = `<div class="muted small">Could not load teams: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderTeamCard(t) {
    return `
      <div class="team-card" data-tid="${t.id}">
        <div class="team-card-head" data-act="toggle">
          <span class="team-caret">▶</span>
          <div>
            <div class="team-card-name">${escapeHtml(t.name)}</div>
            <div class="team-card-meta">
              ${t.description ? escapeHtml(t.description) + ' · ' : ''}
              ${t.member_count} member${t.member_count === 1 ? '' : 's'}
            </div>
          </div>
          <div class="team-card-actions">
            <button class="btn ghost sm" data-act="rename">Rename</button>
            <button class="btn danger sm" data-act="delete">Delete</button>
          </div>
        </div>
        <div class="team-card-body">
          <div class="muted small">Loading members…</div>
        </div>
      </div>
    `;
  }

  function wireTeamCard(card) {
    const tid = Number(card.dataset.tid);
    const head = card.querySelector('[data-act="toggle"]');
    head.addEventListener('click', async (e) => {
      // Don't toggle if clicking on a button inside actions
      if (e.target.closest('button[data-act]')) return;
      if (card.classList.contains('open')) { card.classList.remove('open'); return; }
      card.classList.add('open');
      const bodyEl = card.querySelector('.team-card-body');
      try {
        const members = await api().teams.listMembers(tid);
        bodyEl.innerHTML = members.length === 0
          ? `<div class="muted small">No members on this team.</div>`
          : `<table class="admin-table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last login</th></tr></thead>
              <tbody>
                ${members.map(m => `
                  <tr>
                    <td>${escapeHtml(m.display_name || '—')}</td>
                    <td><span class="mono">${escapeHtml(m.email)}</span></td>
                    <td>${escapeHtml(m.role)}</td>
                    <td class="mono">${escapeHtml(m.last_login_at || '—')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>`;
      } catch (err) {
        bodyEl.innerHTML = `<div class="muted small">Could not load members: ${escapeHtml(err.message)}</div>`;
      }
    });

    card.querySelector('button[data-act="rename"]').addEventListener('click', async () => {
      const current = card.querySelector('.team-card-name').textContent.trim();
      const name = prompt('Rename team to:', current);
      if (!name || name === current) return;
      try {
        await api().teams.update(tid, { name });
        toast('Team renamed.');
        renderTeams(document.getElementById('admin-body'));
      } catch (err) {
        toast(err.message || 'Rename failed.', 'error');
      }
    });

    card.querySelector('button[data-act="delete"]').addEventListener('click', async () => {
      if (!confirm('Delete this team? Members become teamless but are not deleted.')) return;
      try {
        await api().teams.delete(tid);
        toast('Team deleted.');
        renderTeams(document.getElementById('admin-body'));
      } catch (err) {
        toast(err.message || 'Delete failed.', 'error');
      }
    });
  }

  // -------------------------------------------------------------------------
  // PROJECTS
  // -------------------------------------------------------------------------
  async function renderProjects(body) {
    try {
      const projects = await api().admin.projects();
      state.cache.projects = projects;
      body.innerHTML = `
        <div class="admin-section-head">
          <h3>All projects</h3>
          <span class="small">${projects.length} total</span>
        </div>

        ${projects.length === 0 ? `<div class="muted small">No projects.</div>` : `
          <table class="admin-table">
            <thead>
              <tr>
                <th>Name</th><th>Owner</th><th>Members</th><th>Sources</th>
                <th>Assessments</th><th>Updated</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${projects.map(p => `
                <tr>
                  <td>
                    <div style="font-weight:600;">${escapeHtml(p.name)}</div>
                    <div class="muted small">${escapeHtml(p.description || '')}</div>
                  </td>
                  <td>
                    ${escapeHtml(p.owner_name || '—')}
                    <div class="muted small mono">${escapeHtml(p.owner_email || '')}</div>
                  </td>
                  <td>${p.member_count}</td>
                  <td>${p.source_count}</td>
                  <td>${p.assessment_count}</td>
                  <td class="mono">${escapeHtml(fmtDate(p.updated_at))}</td>
                  <td>
                    <span class="status-pill status-${p.archived_at ? 'archived' : 'active'}">
                      ${p.archived_at ? 'archived' : 'active'}
                    </span>
                  </td>
                  <td class="row-actions">
                    ${p.archived_at
                      ? `<button class="btn sm" data-act="restore" data-pid="${p.id}">Restore</button>`
                      : `<button class="btn danger sm" data-act="archive" data-pid="${p.id}">Archive</button>`}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      `;

      body.querySelectorAll('button[data-act="archive"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.pid);
          if (!confirm('Archive this project? Its sources, VoucherVision records, and assessments remain in the database.')) return;
          try {
            await api().projects.delete(id);
            toast('Project archived.');
            renderProjects(body);
          } catch (err) {
            toast(err.message || 'Archive failed.', 'error');
          }
        });
      });
      body.querySelectorAll('button[data-act="restore"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.pid);
          try {
            await api().admin.restoreProject(id);
            toast('Project restored.');
            renderProjects(body);
          } catch (err) {
            toast(err.message || 'Restore failed.', 'error');
          }
        });
      });
    } catch (err) {
      body.innerHTML = `<div class="muted small">Could not load projects: ${escapeHtml(err.message)}</div>`;
    }
  }

  // -------------------------------------------------------------------------
  // entry
  // -------------------------------------------------------------------------
  function open(_user) {
    state.open = true;
    renderShell();
    renderActiveTab();
  }
  function close() {
    state.open = false;
    document.getElementById('modal-root').innerHTML = '';
    // After closing, reload the renderer's project cache in case the admin
    // archived/restored or moved themselves between teams — the chips and
    // pickers need to reflect the new reality.
    if (window.IRIS.session && window.IRIS.session.loadProjects) {
      window.IRIS.session.loadProjects().catch(() => {});
    }
  }

  window.IRIS = window.IRIS || {};
  window.IRIS.AdminDashboard = { open, close };
})();
