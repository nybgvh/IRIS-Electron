const projectService = require('../../server/services/project-service');

module.exports = (register) => {
  register('members:list',       (user, projectId)               => projectService.listMembers(user, projectId));
  register('members:add',        (user, projectId, payload)      => projectService.addMember(user, projectId, payload));
  register('members:updateRole', (user, projectId, userId, role) => projectService.updateMemberRole(user, projectId, userId, role));
  register('members:remove',     (user, projectId, userId)       => projectService.removeMember(user, projectId, userId));
};
