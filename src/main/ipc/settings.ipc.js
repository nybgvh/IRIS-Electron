/*
 * Settings — a per-user key/value bag, now backed by the user_settings table
 * (011_user_settings.sql) so preferences persist across restarts. Mirrors a
 * future REST GET/PATCH /api/settings.
 */

const settingsService = require('../../server/services/user-settings-service');

module.exports = (register) => {
  register('settings:get',    (user)        => settingsService.get(user));
  register('settings:update', (user, patch) => settingsService.update(user, patch));
};
