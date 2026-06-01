(function () {
  function mount(container) {
    const active = window.IRIS.session.getCurrentProject();
    if (!active) {
      window.IRIS.ProjectPage.noProjectPlaceholder(container, {
        title: 'References',
        subtitle: 'vetted sources & authorities for inference',
      });
      return;
    }
    window.IRIS.ProjectPage.placeholder(container, {
      title: 'References',
      subtitle: 'vetted sources & authorities for inference',
      glyph: '§',
      body: `BHL, GBIF, Plants of the World Online, Tropicos, Index Herbariorum, and a Gemini-grounded search plug in here. Project: <em>${active.name}</em>.`,
    });
  }
  window.IRIS = window.IRIS || {};
  window.IRIS.ReferencesPage = { mount };
})();
