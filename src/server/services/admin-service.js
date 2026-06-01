/*
 * Admin dashboard data — cheap aggregate counts for the Stats tab.
 * Admin-only.
 */

const { getDb } = require('../db/connection');
const { GLOBAL_ROLES } = require('../../shared/roles');
const { ForbiddenError, AuthError } = require('../errors');

function requireAdmin(currentUser) {
  if (!currentUser) throw new AuthError();
  if (currentUser.role !== GLOBAL_ROLES.ADMIN) {
    throw new ForbiddenError('Admin role required.');
  }
}

function stats(currentUser) {
  requireAdmin(currentUser);
  const db = getDb();
  const one = (sql) => db.prepare(sql).get().n;
  return {
    users:        one('SELECT COUNT(*) AS n FROM users'),
    teams:        one('SELECT COUNT(*) AS n FROM teams'),
    projects:     one('SELECT COUNT(*) AS n FROM projects WHERE archived_at IS NULL'),
    archived:     one('SELECT COUNT(*) AS n FROM projects WHERE archived_at IS NOT NULL'),
    sources:      one('SELECT COUNT(*) AS n FROM sources'),
    vouchervision: one('SELECT COUNT(*) AS n FROM vouchervision_records'),
    assessments:  one('SELECT COUNT(*) AS n FROM assessments'),
  };
}

/*
 * Project list for the Admin Projects tab. Joins owner display name +
 * member count + source count so the table doesn't N+1.
 */
function projectsOverview(currentUser) {
  requireAdmin(currentUser);
  return getDb().prepare(`
    SELECT
      p.id, p.name, p.description, p.created_at, p.updated_at, p.archived_at,
      p.owner_id,
      u.display_name AS owner_name,
      u.email        AS owner_email,
      (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
      (SELECT COUNT(*) FROM sources s WHERE s.project_id = p.id)           AS source_count,
      (SELECT COUNT(*) FROM assessments a WHERE a.project_id = p.id)       AS assessment_count
    FROM projects p
    LEFT JOIN users u ON u.id = p.owner_id
    ORDER BY p.archived_at IS NULL DESC, p.updated_at DESC
  `).all();
}

function restoreProject(currentUser, id) {
  requireAdmin(currentUser);
  const changes = getDb()
    .prepare('UPDATE projects SET archived_at = NULL WHERE id = ?')
    .run(id).changes;
  return { ok: changes > 0 };
}

module.exports = { stats, projectsOverview, restoreProject };
