const adminService = require('../../server/services/admin-service');

module.exports = (register) => {
  register('admin:stats',            (user)     => adminService.stats(user));
  register('admin:projects',         (user)     => adminService.projectsOverview(user));
  register('admin:restoreProject',   (user, id) => adminService.restoreProject(user, id));
};
