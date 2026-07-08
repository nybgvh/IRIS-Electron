/*
 * Per-user settings service. Durable key/value preferences (011_user_settings)
 * — replaces the old in-memory Map so preferences survive a restart.
 */

const repo = require('../repositories/user-settings-repo');
const { AuthError } = require('../errors');

function get(currentUser) {
  if (!currentUser) throw new AuthError();
  return repo.getAll(currentUser.id);
}

function update(currentUser, patch) {
  if (!currentUser) throw new AuthError();
  return repo.setMany(currentUser.id, patch || {});
}

module.exports = { get, update };
