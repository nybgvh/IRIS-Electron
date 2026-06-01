const assessmentService = require('../../server/services/assessment-service');

module.exports = (register) => {
  register('assessments:list',   (user, projectId)          => assessmentService.list(user, projectId));
  register('assessments:get',    (user, id)                 => assessmentService.get(user, id));
  register('assessments:create', (user, projectId, payload) => assessmentService.create(user, projectId, payload));
  register('assessments:update', (user, id, patch)          => assessmentService.update(user, id, patch));
  register('assessments:delete', (user, id)                 => assessmentService.remove(user, id));
};
