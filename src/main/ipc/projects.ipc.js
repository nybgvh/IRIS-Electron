const projectService = require('../../server/services/project-service');

module.exports = (register) => {
  register('projects:list',   (user)            => projectService.list(user));
  register('projects:get',    (user, id)        => projectService.get(user, id));
  register('projects:create', (user, payload)   => projectService.create(user, payload));
  register('projects:update', (user, id, patch) => projectService.update(user, id, patch));
  register('projects:delete', (user, id)        => projectService.remove(user, id));
};
