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
    move:   invoke('sources:move'),   // (token, id, targetProjectId)
    flag:   invoke('sources:flag'),   // (token, id, flagged)
    checkDuplicates: invoke('sources:checkDuplicates'), // (token, projectId, hashes)
  },
  items: {
    list:    invoke('items:list'),    // (token, projectId, opts)
    summary: invoke('items:summary'), // (token, projectId)
  },
  tags: {
    list:     invoke('tags:list'),     // (token, projectId)
    create:   invoke('tags:create'),   // (token, projectId, body)
    update:   invoke('tags:update'),   // (token, tagId, patch)
    delete:   invoke('tags:delete'),   // (token, tagId)
    assign:   invoke('tags:assign'),   // (token, sourceId, tagId)
    unassign: invoke('tags:unassign'), // (token, sourceId, tagId)
  },
  vouchervision: {
    list:         invoke('vouchervision:list'),         // (token, projectId)
    getForSource: invoke('vouchervision:getForSource'), // (token, sourceId)
    create:       invoke('vouchervision:create'),       // (token, projectId, payload)
    reprocess:    invoke('vouchervision:reprocess'),    // (token, sourceId)
    delete:       invoke('vouchervision:delete'),       // (token, id)
  },
  assessments: {
    list:     invoke('assessments:list'),     // (token, projectId)
    get:      invoke('assessments:get'),      // (token, id)
    create:   invoke('assessments:create'),   // (token, projectId, payload)
    update:   invoke('assessments:update'),   // (token, id, patch)
    delete:   invoke('assessments:delete'),   // (token, id)
    generate: invoke('assessments:generate'), // (token, projectId, opts)
  },
  gbif: {
    getOccurrence: invoke('gbif:getOccurrence'), // (token, projectId, ref)
    saveImport:    invoke('gbif:saveImport'),    // (token, projectId, ref, imageData)
    list:          invoke('gbif:list'),          // (token, projectId)
    remove:        invoke('gbif:remove'),        // (token, id)
    enumerateSearch: invoke('gbif:enumerateSearch'), // (token, projectId, searchUrl, opts)
    bookmark:       invoke('gbif:bookmark'),       // (token, projectId, url, label)
    bookmarks:      invoke('gbif:bookmarks'),      // (token, projectId)
    removeBookmark: invoke('gbif:removeBookmark'), // (token, id)
    setCapture:     invoke('gbif:setCapture'),     // (token, on)
    onDownload:     (cb) => ipcRenderer.on('gbif:download', (_e, data) => cb(data)),
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
