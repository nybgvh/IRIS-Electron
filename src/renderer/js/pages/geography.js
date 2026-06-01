(function () {
  function mount(container) {
    const active = window.IRIS.session.getCurrentProject();
    if (!active) {
      window.IRIS.ProjectPage.noProjectPlaceholder(container, {
        title: 'Geography',
        subtitle: 'collection localities, ranges, and georeferencing',
      });
      return;
    }
    window.IRIS.ProjectPage.placeholder(container, {
      title: 'Geography',
      subtitle: 'collection localities, ranges, and georeferencing',
      glyph: '◉',
      body: `Map view, GBIF cross-checks, Index Herbariorum contacts, and EOO / AOO computation arrive in later phases. Project: <em>${active.name}</em>.`,
    });
  }
  window.IRIS = window.IRIS || {};
  window.IRIS.GeographyPage = { mount };
})();
