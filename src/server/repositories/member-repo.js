const { getDb } = require('../db/connection');

function findRole(projectId, userId) {
  const row = getDb().prepare(`
    SELECT role FROM project_members WHERE project_id = ? AND user_id = ?
  `).get(projectId, userId);
  return row ? row.role : null;
}

function listForProject(projectId) {
  return getDb().prepare(`
    SELECT m.id, m.role, m.added_at,
           u.id AS user_id, u.email, u.display_name
    FROM project_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.project_id = ?
    ORDER BY m.added_at ASC
  `).all(projectId);
}

function add({ project_id, user_id, role, added_by }) {
  getDb().prepare(`
    INSERT INTO project_members (project_id, user_id, role, added_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role
  `).run(project_id, user_id, role, added_by || null);
  return findRole(project_id, user_id);
}

function updateRole(projectId, userId, role) {
  return getDb().prepare(`
    UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?
  `).run(role, projectId, userId).changes > 0;
}

function remove(projectId, userId) {
  return getDb().prepare(`
    DELETE FROM project_members WHERE project_id = ? AND user_id = ?
  `).run(projectId, userId).changes > 0;
}

module.exports = { findRole, listForProject, add, updateRole, remove };
