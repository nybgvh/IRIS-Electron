/*
 * Tag channels. Mirrors future REST:
 *   GET/POST   /api/projects/:id/tags
 *   PATCH/DELETE /api/tags/:id
 *   POST/DELETE /api/sources/:id/tags/:tagId
 */

const tagService = require('../../server/services/tag-service');

module.exports = (register) => {
  register('tags:list',     (user, projectId)        => tagService.list(user, projectId));
  register('tags:create',   (user, projectId, body)  => tagService.create(user, projectId, body || {}));
  register('tags:update',   (user, tagId, patch)     => tagService.update(user, tagId, patch || {}));
  register('tags:delete',   (user, tagId)            => tagService.remove(user, tagId));
  register('tags:assign',   (user, sourceId, tagId)  => tagService.assign(user, sourceId, tagId));
  register('tags:unassign', (user, sourceId, tagId)  => tagService.unassign(user, sourceId, tagId));
};
