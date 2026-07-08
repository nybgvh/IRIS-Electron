const vvService = require('../../server/services/vouchervision-service');

module.exports = (register) => {
  register('vouchervision:list',         (user, projectId)          => vvService.list(user, projectId));
  register('vouchervision:getForSource', (user, sourceId)           => vvService.getForSource(user, sourceId));
  register('vouchervision:create',       (user, projectId, payload) => vvService.create(user, projectId, payload));
  register('vouchervision:reprocess',    (user, sourceId)           => vvService.reprocess(user, sourceId));
  register('vouchervision:delete',       (user, id)                 => vvService.remove(user, id));
};
