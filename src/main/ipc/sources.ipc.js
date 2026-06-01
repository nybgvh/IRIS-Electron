const sourceService = require('../../server/services/source-service');

module.exports = (register) => {
  register('sources:list',   (user, projectId, query) => sourceService.list(user, projectId, query || {}));
  register('sources:upload', (user, projectId, payload) => sourceService.upload(user, projectId, payload));
  register('sources:delete', (user, id) => sourceService.remove(user, id));
};
