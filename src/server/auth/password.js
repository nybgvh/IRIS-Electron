/*
 * Password hashing. Thin wrapper around bcryptjs so the rest of the codebase
 * never imports bcrypt directly — swap implementations here if we move to
 * Argon2 later. bcryptjs is pure-JS (no native build), which sidesteps the
 * cross-platform headache native `bcrypt` causes on Windows in particular.
 */

const bcrypt = require('bcryptjs');

const ROUNDS = 10;

function hashSync(plaintext) {
  return bcrypt.hashSync(plaintext, ROUNDS);
}

async function hash(plaintext) {
  return bcrypt.hash(plaintext, ROUNDS);
}

async function verify(plaintext, hashStr) {
  if (!plaintext || !hashStr) return false;
  return bcrypt.compare(plaintext, hashStr);
}

module.exports = { hashSync, hash, verify };
