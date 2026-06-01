/*
 * Preload bridge.
 *
 * Exposes a single object `window.api` to the renderer with namespaced
 * methods that mirror the IPC channels one-for-one. The renderer never
 * touches ipcRenderer directly — it goes through the namespaced surface
 * here, which the api-client wraps and which a future web port can replace
 * with fetch() calls.
 *
 * Convention for every method (except auth.login and updater.*): the first
 * argument the IPC handler receives is the auth token. The renderer's
 * api-client injects the token transparently so page code never threads it
 * through manually.
 */

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

const api = {
  auth: {
    login:  invoke('auth:login'),    // (credentials)
    logout: invoke('auth:logout'),   // (token)
    me:     invoke('auth:me'),       // (token)
  },
  users: {
    list:   invoke('users:list'),    // (token)
    create: invoke('users:create'),  // (token, payload)
    update: invoke('users:update'),  // (token, id, patch)
    delete: invoke('users:delete'),  // (token, id)
  },
  teams: {
    list:         invoke('teams:list'),         // (token)
    get:          invoke('teams:get'),          // (token, id)
    create:       invoke('teams:create'),       // (token, payload)
    update:       invoke('teams:update'),       // (token, id, patch)
    delete:       invoke('teams:delete'),       // (token, id)
    listMembers:  invoke('teams:listMembers'),  // (token, id)
    myTeammates:  invoke('teams:myTeammates'),  // (token)
  },
  admin: {
    stats:           invoke('admin:stats'),           // (token)
    projects:        invoke('admin:projects'),        // (token)
    restoreProject:  invoke('admin:restoreProject'),  // (token, id)
  },
  projects: {
    list:   invoke('projects:list'),   // (token)
    get:    invoke('projects:get'),    // (token, id)
    create: invoke('projects:create'), // (token, payload)
    update: invoke('projects:update'), // (token, id, patch)
    delete: invoke('projects:delete'), // (token, id)
  },
  members: {
    list:       invoke('members:list'),       // (token, projectId)
    add:        invoke('members:add'),        // (token, projectId, payload)
    updateRole: invoke('members:updateRole'), // (token, projectId, userId, role)
    remove:     invoke('members:remove'),     // (token, projectId, userId)
  },
  sources: {
    list:   invoke('sources:list'),   // (token, projectId, query)
    upload: invoke('sources:upload'), // (token, projectId, payload)
    delete: invoke('sources:delete'), // (token, id)
  },
  vouchervision: {
    list:   invoke('vouchervision:list'),   // (token, projectId)
    create: invoke('vouchervision:create'), // (token, projectId, payload)
    delete: invoke('vouchervision:delete'), // (token, id)
  },
  assessments: {
    list:   invoke('assessments:list'),   // (token, projectId)
    get:    invoke('assessments:get'),    // (token, id)
    create: invoke('assessments:create'), // (token, projectId, payload)
    update: invoke('assessments:update'), // (token, id, patch)
    delete: invoke('assessments:delete'), // (token, id)
  },
  settings: {
    get:    invoke('settings:get'),    // (token)
    update: invoke('settings:update'), // (token, patch)
  },
  updater: {
    info:     invoke('updater:info'),
    check:    invoke('updater:check'),
    download: invoke('updater:download'),
    install:  invoke('updater:install'),
    onStatus: (cb) => ipcRenderer.on('updater:status', (_e, data) => cb(data)),
  },
};

contextBridge.exposeInMainWorld('api', api);
