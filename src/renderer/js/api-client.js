/*
 * api-client.js
 *
 * Single source of truth for how the renderer talks to the backend.
 * Today it wraps window.api (IPC). Tomorrow, the implementation of the same
 * methods will use fetch() against /api/* routes — no page code changes.
 *
 * Every method returns the unwrapped response data, or throws an
 * ApiError. The page code never sees the { ok, data, error } envelope.
 */

(function () {
  class ApiError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
    }
  }

  function unwrap(envelope) {
    if (envelope && envelope.ok) return envelope.data;
    const err = (envelope && envelope.error) || {};
    throw new ApiError(err.code || 'app/error', err.message || 'Unknown error.');
  }

  // Token is injected by the api-client so page code doesn't thread it
  // through. The session module sets it.
  let token = null;
  function setToken(value) { token = value; }
  function getToken() { return token; }

  function withTok(fn) { return (...args) => fn(token, ...args).then(unwrap); }
  function noTok(fn)   { return (...args) => fn(...args).then(unwrap); }

  const raw = window.api;

  const client = {
    auth: {
      login:  (credentials) => raw.auth.login(credentials).then(unwrap),
      logout: () => raw.auth.logout(token).then(unwrap),
      me:     () => raw.auth.me(token).then(unwrap),
    },
    users: {
      list:   withTok(raw.users.list),
      create: withTok(raw.users.create),
      update: withTok(raw.users.update),
      delete: withTok(raw.users.delete),
    },
    teams: {
      list:         withTok(raw.teams.list),
      get:          withTok(raw.teams.get),
      create:       withTok(raw.teams.create),
      update:       withTok(raw.teams.update),
      delete:       withTok(raw.teams.delete),
      listMembers:  withTok(raw.teams.listMembers),
      myTeammates:  withTok(raw.teams.myTeammates),
    },
    admin: {
      stats:          withTok(raw.admin.stats),
      projects:       withTok(raw.admin.projects),
      restoreProject: withTok(raw.admin.restoreProject),
    },
    projects: {
      list:   withTok(raw.projects.list),
      get:    withTok(raw.projects.get),
      create: withTok(raw.projects.create),
      update: withTok(raw.projects.update),
      delete: withTok(raw.projects.delete),
    },
    members: {
      list:       withTok(raw.members.list),
      add:        withTok(raw.members.add),
      updateRole: withTok(raw.members.updateRole),
      remove:     withTok(raw.members.remove),
    },
    sources: {
      list:   withTok(raw.sources.list),
      upload: withTok(raw.sources.upload),
      delete: withTok(raw.sources.delete),
      move:   withTok(raw.sources.move),
      flag:   withTok(raw.sources.flag),
      checkDuplicates: withTok(raw.sources.checkDuplicates),
    },
    items: {
      list:    withTok(raw.items.list),
      summary: withTok(raw.items.summary),
    },
    tags: {
      list:     withTok(raw.tags.list),
      create:   withTok(raw.tags.create),
      update:   withTok(raw.tags.update),
      delete:   withTok(raw.tags.delete),
      assign:   withTok(raw.tags.assign),
      unassign: withTok(raw.tags.unassign),
    },
    vouchervision: {
      list:         withTok(raw.vouchervision.list),
      getForSource: withTok(raw.vouchervision.getForSource),
      create:       withTok(raw.vouchervision.create),
      reprocess:    withTok(raw.vouchervision.reprocess),
      delete:       withTok(raw.vouchervision.delete),
    },
    assessments: {
      list:     withTok(raw.assessments.list),
      get:      withTok(raw.assessments.get),
      create:   withTok(raw.assessments.create),
      update:   withTok(raw.assessments.update),
      delete:   withTok(raw.assessments.delete),
      generate: withTok(raw.assessments.generate),
    },
    gbif: {
      getOccurrence: withTok(raw.gbif.getOccurrence),
      saveImport:    withTok(raw.gbif.saveImport),
      list:          withTok(raw.gbif.list),
      remove:        withTok(raw.gbif.remove),
      enumerateSearch: withTok(raw.gbif.enumerateSearch),
      bookmark:       withTok(raw.gbif.bookmark),
      bookmarks:      withTok(raw.gbif.bookmarks),
      removeBookmark: withTok(raw.gbif.removeBookmark),
      setCapture:     withTok(raw.gbif.setCapture),
      onDownload:     raw.gbif.onDownload,
    },
    settings: {
      get:    withTok(raw.settings.get),
      update: withTok(raw.settings.update),
    },
    updater: {
      info:     noTok(raw.updater.info),
      check:    noTok(raw.updater.check),
      download: noTok(raw.updater.download),
      install:  noTok(raw.updater.install),
      onStatus: raw.updater.onStatus,
    },
  };

  window.IRIS = window.IRIS || {};
  window.IRIS.api = client;
  window.IRIS.ApiError = ApiError;
  window.IRIS.apiToken = { set: setToken, get: getToken };
})();
