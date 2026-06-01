/*
 * Settings is a per-user key/value bag. Phase 0 stores it in memory — the
 * renderer's Settings dialog only needs a place to round-trip preferences
 * during a session. When a settings table is added (likely migration 007),
 * swap this for a real repo + service.
 */

const settingsByUser = new Map();

module.exports = (register) => {
  register('settings:get', (user) => {
    return settingsByUser.get(user.id) || {};
  });
  register('settings:update', (user, patch) => {
    const current = settingsByUser.get(user.id) || {};
    const next = { ...current, ...(patch || {}) };
    settingsByUser.set(user.id, next);
    return next;
  });
};
