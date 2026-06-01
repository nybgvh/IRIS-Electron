(function () {
  function mount(container) {
    const active = window.IRIS.session.getCurrentProject();
    if (!active) {
      window.IRIS.ProjectPage.noProjectPlaceholder(container, {
        title: 'Assessment',
        subtitle: 'IUCN Red List drafting & review',
      });
      return;
    }
    window.IRIS.ProjectPage.placeholder(container, {
      title: 'Assessment',
      subtitle: 'IUCN Red List drafting & review',
      glyph: '✦',
      body: `Assessments capture scientific name, IUCN category and criteria, and the six narrative sections. Project: <em>${active.name}</em>.`,
    });
  }
  window.IRIS = window.IRIS || {};
  window.IRIS.AssessmentPage = { mount };
})();
