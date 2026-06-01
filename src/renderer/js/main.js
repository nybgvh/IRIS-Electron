/*
 * Renderer boot.
 * On every session change (login, logout) the router re-mounts the right
 * top-level view. There's no persistent token in Phase 0 — the user logs in
 * fresh on each launch.
 */
(function () {
  window.IRIS.session.onChange(() => {
    window.IRIS.router.boot();
  });
  window.IRIS.router.boot();
})();
