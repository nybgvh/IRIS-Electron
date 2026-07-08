const sourceService = require('../../server/services/source-service');

module.exports = (register) => {
  register('sources:list',   (user, projectId, query) => sourceService.list(user, projectId, query || {}));
  register('sources:upload', (user, projectId, payload) => sourceService.upload(user, projectId, payload));
  register('sources:delete', (user, id) => sourceService.remove(user, id));
  register('sources:move',   (user, id, targetProjectId) => sourceService.move(user, id, targetProjectId));
  register('sources:flag',   (user, id, flagged) => sourceService.setFlag(user, id, flagged));
  register('sources:checkDuplicates', (user, projectId, hashes) => sourceService.checkDuplicates(user, projectId, hashes));
};
