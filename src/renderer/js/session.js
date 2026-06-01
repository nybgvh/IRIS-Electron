/*
 * Session state in the renderer. Holds:
 *   - currentUser  — the authenticated user (or null)
 *   - currentProject — the active project context (or null). Every
 *     project-scoped tab (Sources, Geography, Assessment, References)
 *     reads from this. Switching projects fires onProjectChange so
 *     subscribed pages re-fetch + re-render.
 *
 * Both pieces of state are kept in memory only. The user logs in fresh
 * each launch (Phase 0); the active project is auto-picked on login
 * (first project the user is a member of) and is overridable from the
 * topbar project switcher or the Project tab.
 */

(function () {
  let currentUser = null;
  let currentProject = null;
  let projects = [];

  const userListeners = new Set();
  const projectListeners = new Set();

  function notifyUser()    { for (const fn of userListeners)    fn(currentUser); }
  function notifyProject() { for (const fn of projectListeners) fn(currentProject); }

  // ----- user --------------------------------------------------------------
  function get() { return currentUser; }
  function onChange(fn) { userListeners.add(fn); return () => userListeners.delete(fn); }

  async function login(credentials) {
    const { user, token } = await window.IRIS.api.auth.login(credentials);
    window.IRIS.apiToken.set(token);
    currentUser = user;
    notifyUser();
    return user;
  }

  async function logout() {
    try { await window.IRIS.api.auth.logout(); } catch (_) {}
    window.IRIS.apiToken.set(null);
    currentUser = null;
    currentProject = null;
    projects = [];
    notifyUser();
    notifyProject();
  }

  // ----- projects ----------------------------------------------------------
  function getProjects()        { return projects; }
  function getCurrentProject()  { return currentProject; }
  function onProjectChange(fn)  { projectListeners.add(fn); return () => projectListeners.delete(fn); }

  /*
   * Refresh the cached project list from the server and reconcile the
   * active project:
   *   - If the active project still exists in the list, keep it (refresh
   *     its fields from the new row).
   *   - Otherwise, pick the first project, or null if there are none.
   */
  async function loadProjects() {
    projects = await window.IRIS.api.projects.list();
    if (currentProject) {
      const found = projects.find(p => p.id === currentProject.id);
      currentProject = found || projects[0] || null;
    } else {
      currentProject = projects[0] || null;
    }
    notifyProject();
    return projects;
  }

  function setCurrentProject(project) {
    if (!project) { currentProject = null; notifyProject(); return; }
    // accept either a full project object or just an id
    const id = typeof project === 'object' ? project.id : project;
    const found = projects.find(p => p.id === id) || (typeof project === 'object' ? project : null);
    if (found) {
      currentProject = found;
      notifyProject();
    }
  }

  window.IRIS = window.IRIS || {};
  window.IRIS.session = {
    // user
    get, onChange, login, logout,
    // projects
    getProjects, getCurrentProject, onProjectChange,
    loadProjects, setCurrentProject,
  };
})();
