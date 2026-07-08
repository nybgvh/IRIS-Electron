/*
 * Item read model + project dashboard summary. Mirrors future REST:
 *   GET /api/projects/:id/items?type=&status=&tagId=&search=
 *   GET /api/projects/:id/summary
 */

const itemService = require('../../server/services/item-service');

module.exports = (register) => {
  register('items:list',    (user, projectId, opts) => itemService.list(user, projectId, opts || {}));
  register('items:summary', (user, projectId)       => itemService.summary(user, projectId));
};
