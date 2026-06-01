/*
 * Session store. Phase 0 uses an in-memory map keyed by opaque token →
 * { user_id, created_at }. Lost on app restart, which is fine for a desktop
 * prototype (the renderer re-authenticates on boot).
 *
 * Web port: replace this module's implementation with one backed by a
 * Redis client or signed JWTs. The exported surface — create / get / destroy
 * — does not change.
 */

const crypto = require('crypto');

const TOKEN_BYTES = 32;
const sessions = new Map();

function newToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function create(userId) {
  const token = newToken();
  sessions.set(token, { user_id: userId, created_at: Date.now() });
  return token;
}

function get(token) {
  if (!token) return null;
  return sessions.get(token) || null;
}

function destroy(token) {
  if (!token) return false;
  return sessions.delete(token);
}

function destroyAllFor(userId) {
  for (const [token, sess] of sessions.entries()) {
    if (sess.user_id === userId) sessions.delete(token);
  }
}

module.exports = { create, get, destroy, destroyAllFor };
