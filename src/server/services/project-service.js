/*
 * Project + membership service. Authorization is enforced here using the
 * capability matrix from shared/capabilities.js. Admins are short-circuited
 * to "allowed" without consulting project_members.
 */

const projectRepo = require('../repositories/project-repo');
const memberRepo = require('../repositories/member-repo');
const userRepo = require('../repositories/user-repo');
const { transaction } = require('../db/connection');
const { GLOBAL_ROLES, PROJECT_ROLES, PROJECT_ROLE_LIST } = require('../../shared/roles');
const { CAPS, can } = require('../../shared/capabilities');
const {
  AuthError, ForbiddenError, NotFoundError, ValidationError,
} = require('../errors');

function requireUser(currentUser) {
  if (!currentUser) throw new AuthError();
  return currentUser;
}

function effectiveRole(projectId, user) {
  if (user.role === GLOBAL_ROLES.ADMIN) return PROJECT_ROLES.OWNER;
  return memberRepo.findRole(projectId, user.id);
}

function requireCap(projectId, user, capability) {
  const role = effectiveRole(projectId, user);
  if (!role) throw new ForbiddenError('Not a member of this project.');
  if (user.role === GLOBAL_ROLES.ADMIN) return role;
  if (!can(role, capability)) {
    throw new ForbiddenError(`Role "${role}" cannot perform "${capability}".`);
  }
  return role;
}

function list(currentUser) {
  requireUser(currentUser);
  return currentUser.role === GLOBAL_ROLES.ADMIN
    ? projectRepo.listAll()
    : projectRepo.listForUser(currentUser.id);
}

function get(currentUser, id) {
  requireUser(currentUser);
  requireCap(id, currentUser, CAPS.PROJECT_VIEW);
  const project = projectRepo.findById(id);
  if (!project) throw new NotFoundError('Project not found.');
  return project;
}

function create(currentUser, { name, description }) {
  requireUser(currentUser);
  if (!name || !String(name).trim()) {
    throw new ValidationError('Project name is required.');
  }
  // Wrap project insert + owner-member insert in one transaction so we
  // never end up with a project that has no owner row.
  const tx = transaction(() => {
    const project = projectRepo.create({
      name: String(name).trim(),
      description,
      owner_id: currentUser.id,
    });
    memberRepo.add({
      project_id: project.id,
      user_id: currentUser.id,
      role: PROJECT_ROLES.OWNER,
      added_by: currentUser.id,
    });
    return project;
  });
  return tx();
}

function update(currentUser, id, patch) {
  requireUser(currentUser);
  requireCap(id, currentUser, CAPS.PROJECT_EDIT);
  const safe = {};
  if (patch.name !== undefined) safe.name = String(patch.name).trim();
  if (patch.description !== undefined) safe.description = patch.description;
  return projectRepo.update(id, safe);
}

function remove(currentUser, id) {
  requireUser(currentUser);
  requireCap(id, currentUser, CAPS.PROJECT_DELETE);
  const ok = projectRepo.archive(id);
  if (!ok) throw new NotFoundError('Project not found.');
  return { ok: true };
}

// --- membership ----------------------------------------------------------

function listMembers(currentUser, projectId) {
  requireUser(currentUser);
  requireCap(projectId, currentUser, CAPS.PROJECT_VIEW);
  return memberRepo.listForProject(projectId);
}

function addMember(currentUser, projectId, payload) {
  requireUser(currentUser);
  requireCap(projectId, currentUser, CAPS.MEMBERS_MANAGE);
  const { user_id, email, role } = payload || {};
  if (!PROJECT_ROLE_LIST.includes(role)) {
    throw new ValidationError('Invalid project role.');
  }
  // Resolve to a user row from either a user_id (new dropdown picker path)
  // or an email (legacy free-text path, still useful for admins).
  let user = null;
  if (user_id) {
    user = userRepo.findById(Number(user_id));
    if (!user) throw new NotFoundError('User not found.');
  } else if (email) {
    user = userRepo.findByEmail(email);
    if (!user) throw new NotFoundError('No user with that email.');
  } else {
    throw new ValidationError('Provide either user_id or email.');
  }
  memberRepo.add({
    project_id: projectId,
    user_id: user.id,
    role,
    added_by: currentUser.id,
  });
  return memberRepo.listForProject(projectId);
}

function updateMemberRole(currentUser, projectId, userId, role) {
  requireUser(currentUser);
  requireCap(projectId, currentUser, CAPS.MEMBERS_MANAGE);
  if (!PROJECT_ROLE_LIST.includes(role)) {
    throw new ValidationError('Invalid project role.');
  }
  // Invariant: the creator-owner row (project.owner_id) must keep role='owner'.
  // Other rows can be promoted to owner or demoted freely.
  const project = projectRepo.findById(projectId);
  if (project && Number(project.owner_id) === Number(userId) && role !== PROJECT_ROLES.OWNER) {
    throw new ValidationError(
      'The project creator must keep the owner role.',
      'members/owner-role-locked'
    );
  }
  memberRepo.updateRole(projectId, userId, role);
  return memberRepo.listForProject(projectId);
}

function removeMember(currentUser, projectId, userId) {
  requireUser(currentUser);
  requireCap(projectId, currentUser, CAPS.MEMBERS_MANAGE);
  // Invariant: the creator-owner row cannot be removed — projects always
  // have at least one member, and that member is the creator-owner.
  const project = projectRepo.findById(projectId);
  if (project && Number(project.owner_id) === Number(userId)) {
    throw new ValidationError(
      'Cannot remove the project creator.',
      'members/cannot-remove-owner'
    );
  }
  memberRepo.remove(projectId, userId);
  return memberRepo.listForProject(projectId);
}

module.exports = {
  list, get, create, update, remove,
  listMembers, addMember, updateMemberRole, removeMember,
  // exported for other services that need to gate on a capability
  requireCap, effectiveRole,
};
