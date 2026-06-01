const userService = require('../../server/services/user-service');

module.exports = (register) => {
  register('users:list',   (user)            => userService.list(user));
  register('users:create', (user, payload)   => userService.create(user, payload));
  register('users:update', (user, id, patch) => userService.update(user, id, patch));
  register('users:delete', (user, id)        => userService.remove(user, id));
};
