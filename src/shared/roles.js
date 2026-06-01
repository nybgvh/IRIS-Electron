/*
 * Role definitions — shared between server (for auth checks) and renderer
 * (for UI gating). Two axes:
 *
 *   GLOBAL_ROLES — stored on users.role. The only escalated value is "admin",
 *     which bypasses per-project checks entirely. Everyone else is "member"
 *     and gets project-scoped permissions via project_members.role.
 *
 *   PROJECT_ROLES — stored on project_members.role. A user's effective rights
 *     on a project come from this row (or from being a global admin).
 *
 * Keep these strings stable: they live in the database as CHECK-constraint
 * values. Adding a new role is a migration, not a code change.
 */

const GLOBAL_ROLES = Object.freeze({
  ADMIN: 'admin',
  MEMBER: 'member',
});

const PROJECT_ROLES = Object.freeze({
  OWNER: 'owner',
  EDITOR: 'editor',
  UPLOADER: 'uploader',
});

const PROJECT_ROLE_LIST = Object.freeze([
  PROJECT_ROLES.OWNER,
  PROJECT_ROLES.EDITOR,
  PROJECT_ROLES.UPLOADER,
]);

module.exports = {
  GLOBAL_ROLES,
  PROJECT_ROLES,
  PROJECT_ROLE_LIST,
};
