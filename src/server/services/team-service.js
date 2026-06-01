/*
 * Team service. CRUD is admin-gated; reads needed by the project member
 * picker (listMyTeammates) are available to any authenticated user.
 */

const teamRepo = require('../repositories/team-repo');
const userRepo = require('../repositories/user-repo');
const { GLOBAL_ROLES } = require('../../shared/roles');
const {
  AuthError, ForbiddenError, NotFoundError, ValidationError,
} = require('../errors');

function requireUser(currentUser) {
  if (!currentUser) throw new AuthError();
  return currentUser;
}

function requireAdmin(currentUser) {
  requireUser(currentUser);
  if (currentUser.role !== GLOBAL_ROLES.ADMIN) {
    throw new ForbiddenError('Admin role required.');
  }
}

function list(currentUser) {
  requireAdmin(currentUser);
  return teamRepo.listAll();
}

function get(currentUser, id) {
  requireAdmin(currentUser);
  const team = teamRepo.findById(id);
  if (!team) throw new NotFoundError('Team not found.');
  return team;
}

function create(currentUser, { name, description }) {
  requireAdmin(currentUser);
  if (!name || !String(name).trim()) {
    throw new ValidationError('Team name is required.');
  }
  if (teamRepo.findByName(name.trim())) {
    throw new ValidationError('A team with that name already exists.', 'teams/name-taken');
  }
  return teamRepo.create({ name: name.trim(), description });
}

function update(currentUser, id, patch) {
  requireAdmin(currentUser);
  const safe = {};
  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name) throw new ValidationError('Team name cannot be empty.');
    const existing = teamRepo.findByName(name);
    if (existing && existing.id !== id) {
      throw new ValidationError('A team with that name already exists.', 'teams/name-taken');
    }
    safe.name = name;
  }
  if (patch.description !== undefined) safe.description = patch.description;
  return teamRepo.update(id, safe);
}

function remove(currentUser, id) {
  requireAdmin(currentUser);
  if (!teamRepo.findById(id)) throw new NotFoundError('Team not found.');
  // ON DELETE SET NULL on users.team_id handles dangling references — see
  // migration 007. Members survive; they just become teamless.
  return { ok: teamRepo.remove(id) };
}

function listMembers(currentUser, teamId) {
  requireAdmin(currentUser);
  if (!teamRepo.findById(teamId)) throw new NotFoundError('Team not found.');
  return teamRepo.listMembers(teamId);
}

/*
 * The lookup the project-member picker uses. Returns everyone on the
 * caller's team except the caller themselves. Empty array if the caller
 * has no team — the UI surfaces that with a hint.
 */
function listMyTeammates(currentUser) {
  requireUser(currentUser);
  // currentUser may not have team_id if it was set from a stale token;
  // re-fetch from the DB to be safe.
  const me = userRepo.findById(currentUser.id);
  if (!me || !me.team_id) return [];
  return teamRepo.listTeammates(me.team_id, me.id);
}

module.exports = {
  list, get, create, update, remove,
  listMembers, listMyTeammates,
};
