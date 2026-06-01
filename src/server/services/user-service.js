/*
 * User CRUD. All operations are admin-gated except `getSelf`.
 * Authorization happens here, not in the host layer, so the rules travel
 * with the service when it's ported to a web backend.
 */

const userRepo = require('../repositories/user-repo');
const password = require('../auth/password');
const { GLOBAL_ROLES } = require('../../shared/roles');
const {
  ForbiddenError, ValidationError, NotFoundError,
} = require('../errors');
const { publicUser } = require('./auth-service');

function requireAdmin(currentUser) {
  if (!currentUser || currentUser.role !== GLOBAL_ROLES.ADMIN) {
    throw new ForbiddenError('Admin role required.');
  }
}

function list(currentUser) {
  requireAdmin(currentUser);
  return userRepo.listAll().map(publicUser);
}

async function create(currentUser, { email, password: pw, display_name, role, team_id }) {
  requireAdmin(currentUser);
  if (!email || !pw) throw new ValidationError('Email and password are required.');
  if (role && ![GLOBAL_ROLES.ADMIN, GLOBAL_ROLES.MEMBER].includes(role)) {
    throw new ValidationError('Invalid role.');
  }
  const existing = userRepo.findByEmail(email);
  if (existing) throw new ValidationError('Email already in use.', 'users/email-taken');
  const user = userRepo.create({
    email,
    password_hash: await password.hash(pw),
    display_name,
    role: role || GLOBAL_ROLES.MEMBER,
    team_id: team_id || null,
  });
  return publicUser(user);
}

async function update(currentUser, id, patch) {
  requireAdmin(currentUser);
  const user = userRepo.findById(id);
  if (!user) throw new NotFoundError('User not found.');
  const safe = {};
  if (patch.display_name !== undefined) safe.display_name = patch.display_name;
  if (patch.role !== undefined) {
    if (![GLOBAL_ROLES.ADMIN, GLOBAL_ROLES.MEMBER].includes(patch.role)) {
      throw new ValidationError('Invalid role.');
    }
    safe.role = patch.role;
  }
  if (patch.team_id !== undefined) {
    // null is allowed — unassigning a user from any team.
    safe.team_id = patch.team_id === null ? null : Number(patch.team_id);
  }
  if (patch.password) safe.password_hash = await password.hash(patch.password);
  return publicUser(userRepo.update(id, safe));
}

function remove(currentUser, id) {
  requireAdmin(currentUser);
  if (currentUser.id === id) {
    throw new ValidationError('Cannot delete yourself.', 'users/self-delete');
  }
  const ok = userRepo.remove(id);
  if (!ok) throw new NotFoundError('User not found.');
  return { ok: true };
}

module.exports = { list, create, update, remove };
