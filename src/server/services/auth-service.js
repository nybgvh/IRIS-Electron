/*
 * Authentication service. The shape of these methods mirrors what an Express
 * controller would expose:
 *
 *   login(credentials)  → { user, token }
 *   logout(token)       → { ok }
 *   me(token)           → { user }
 *
 * The renderer holds the token in memory (and may persist it in localStorage
 * in a later phase). Every other service call takes a `currentUser` derived
 * from this token by the host layer (see main/ipc/index.js).
 */

const userRepo = require('../repositories/user-repo');
const session = require('../auth/session');
const password = require('../auth/password');
const { AuthError } = require('../errors');

function publicUser(user) {
  if (!user) return null;
  const { password_hash, ...rest } = user;
  return rest;
}

async function login({ email, password: plaintext }) {
  if (!email || !plaintext) {
    throw new AuthError('Email and password are required.', 'auth/missing-credentials');
  }
  const user = userRepo.findByEmail(email);
  if (!user) {
    throw new AuthError('Invalid email or password.', 'auth/invalid-credentials');
  }
  const ok = await password.verify(plaintext, user.password_hash);
  if (!ok) {
    throw new AuthError('Invalid email or password.', 'auth/invalid-credentials');
  }
  userRepo.recordLogin(user.id);
  const token = session.create(user.id);
  return { user: publicUser(user), token };
}

function logout(token) {
  session.destroy(token);
  return { ok: true };
}

function userFromToken(token) {
  const sess = session.get(token);
  if (!sess) return null;
  return userRepo.findById(sess.user_id) || null;
}

function me(token) {
  const user = userFromToken(token);
  if (!user) throw new AuthError();
  return { user: publicUser(user) };
}

module.exports = { login, logout, me, userFromToken, publicUser };
