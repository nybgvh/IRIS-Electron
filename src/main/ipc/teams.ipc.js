const teamService = require('../../server/services/team-service');

module.exports = (register) => {
  register('teams:list',         (user)              => teamService.list(user));
  register('teams:get',          (user, id)          => teamService.get(user, id));
  register('teams:create',       (user, payload)     => teamService.create(user, payload));
  register('teams:update',       (user, id, patch)   => teamService.update(user, id, patch));
  register('teams:delete',       (user, id)          => teamService.remove(user, id));
  register('teams:listMembers',  (user, id)          => teamService.listMembers(user, id));
  register('teams:myTeammates',  (user)              => teamService.listMyTeammates(user));
};
