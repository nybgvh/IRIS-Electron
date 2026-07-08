// Renderer boot smoke: loads the REAL renderer (index.html + preload + all
// page scripts) in a hidden window against a seeded in-memory DB, and reports
// any uncaught error / failed script eval. Catches the class of bug where a
// preload/api-client mismatch white-screens the UI.
//
// Run (real Electron, NOT run-as-node):
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/smoke-renderer.js

const os = require('os');
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const dbConn = require('../src/server/db/connection');
const { runMigrations } = require('../src/server/db/migrate');
const { runSeed } = require('../src/server/db/seed');
const fileStore = require('../src/server/storage/file-store');
const ipc = require('../src/main/ipc');
const irisProtocol = require('../src/main/protocol');
const authService = require('../src/server/services/auth-service');
const projectService = require('../src/server/services/project-service');
const sourceRepo = require('../src/server/repositories/source-repo');
const vvRepo = require('../src/server/repositories/vouchervision-repo');
const assessmentRepo = require('../src/server/repositories/assessment-repo');
const gbifRepo = require('../src/server/repositories/gbif-source-repo');

// Insert georeferenced, completed specimens so the Geography map has real data
// to plot (4 points → a convex-hull polygon + EOO area). Returns the project id.
async function seedGeoProject() {
  const { token } = await authService.login({ email: 'admin@gmail.com', password: '1234' });
  const user = authService.userFromToken(token);
  const project = projectService.create(user, { name: 'Geo Test' });
  const coords = [[40.862, -73.878], [40.905, -73.848], [40.828, -73.902], [40.889, -73.833]];
  const sourceIds = [];
  coords.forEach(([lat, lng], i) => {
    const s = sourceRepo.create({
      project_id: project.id, uploaded_by: user.id, source_type: 'image',
      filename: `geo_${i}.jpg`, storage_path: `x/geo_${i}.jpg`, mime_type: 'image/jpeg',
      sha256: `hash${i}`, metadata_json: {},
    });
    sourceIds.push(s.id);
    const rec = vvRepo.create({ project_id: project.id, source_id: s.id, storage_path: 'x', status: 'pending', created_by: user.id });
    vvRepo.setComplete(rec.id, {
      storage_path: 'x', ocr_text: 'ocr', scientific_name: 'Testus geo',
      formatted_json: { scientificName: 'Testus geo', catalogNumber: `MICH${i}`, decimalLatitude: String(lat), decimalLongitude: String(lng) },
    });
  });
  // an assessment run whose sections cite specimens by tag (catalog + filename)
  const a = assessmentRepo.create({
    project_id: project.id, scientific_name: 'Testus geo', status: 'draft', version: 1,
    generated_by_model: 'mock', generated_at: '2026-07-06T00:00:00Z',
    payload_json: {
      sections: {
        Taxonomy: 'Testus geo L., grounded in #{MICH0} and #{geo_1}.',
        Geographic_Range: 'Recorded near Nairobi #{MICH2}.',
        Habitat: '', Ecology: '', Use_and_Trade: '', Threats_and_Conservation_Actions: '',
      },
      record_count: 4, source_ids: sourceIds, generated: true,
    },
    created_by: user.id,
  });
  assessmentRepo.setSeries(a.id, a.id);

  // a GBIF reference imported into the project (References tab renders these)
  gbifRepo.create({
    project_id: project.id, source_id: sourceIds[0], gbif_id: '5900885383',
    occurrence_url: 'https://gbif.org/occurrence/5900885383',
    image_url: 'https://ngpherbaria.org/media/ngph/CSCN/CSCN-V-0059/CSCN-V-0059095.jpg',
    citation: 'High Plains Herbarium at Chadron State College (2026). Chadron State College, High Plains Herbarium. Occurrence dataset https://doi.org/10.15468/wrrrke accessed via GBIF.org on 2026-07-07. https://gbif.org/occurrence/5900885383',
    scientific_name: 'Acer negundo var. interius', dataset_doi: '10.15468/wrrrke',
    country: 'United States of America', created_by: user.id,
  });
  // a saved GBIF search (bookmark) for the split-button dropdown
  gbifRepo.createBookmark({
    project_id: project.id, url: 'https://www.gbif.org/occurrence/search?q=Acer&view=GALLERY',
    label: '“Acer”', created_by: user.id,
  });
  return project.id;
}

irisProtocol.registerSchemes();

const errors = [];

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-rend-'));
  fileStore.init(tmp);
  dbConn.init(':memory:');
  runMigrations();
  runSeed();
  irisProtocol.register();
  ipc.registerAll();
  const geoPid = await seedGeoProject();

  const win = new BrowserWindow({
    show: false, width: 1280, height: 900,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, webviewTag: true,
    },
  });

  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(`console[${level}]: ${message}`);
  });
  win.webContents.on('render-process-gone', (_e, d) => { errors.push(`render-gone: ${d.reason}`); });

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await win.webContents.executeJavaScript(
    'window.__errs=[]; window.addEventListener("error", e => window.__errs.push(e.error && e.error.stack || String(e.message)));');
  // give scripts a tick to evaluate + the login page to mount
  await new Promise(r => setTimeout(r, 800));

  // Assert the whole renderer surface evaluated: api namespaces + pages exist,
  // and drive a login → app render → tab switches to exercise page mounts.
  const report = await win.webContents.executeJavaScript(`(async () => {
    const out = { checks: {}, errors: [] };
    try {
      const api = window.IRIS && window.IRIS.api;
      out.checks.apiItems = !!(api && api.items && api.items.list);
      out.checks.apiTags = !!(api && api.tags && api.tags.assign);
      out.checks.apiGenerate = !!(api && api.assessments && api.assessments.generate);
      out.checks.apiReprocess = !!(api && api.vouchervision && api.vouchervision.reprocess);
      out.checks.libraryPage = !!(window.IRIS && window.IRIS.SourcesPage);
      out.checks.assessmentPage = !!(window.IRIS && window.IRIS.AssessmentPage);
      out.checks.geographyPage = !!(window.IRIS && window.IRIS.GeographyPage);
      out.checks.leafletLoaded = typeof window.L !== 'undefined' && !!window.L.map;
      out.checks.apiFlag = !!(api && api.sources && api.sources.flag);
      out.checks.apiCheckDuplicates = !!(api && api.sources && api.sources.checkDuplicates);
      out.checks.dialogLoaded = !!(window.IRIS && window.IRIS.dialog);
      // client SHA-256 must be available AND match Node's (== server hash)
      out.checks.cryptoSubtle = !!(window.crypto && window.crypto.subtle && window.crypto.subtle.digest);
      if (out.checks.cryptoSubtle) {
        const d = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode('hello').buffer);
        const hex = [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
        out.checks.clientHashMatchesServer = hex === '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
      }
      // dialog opens and resolves to the clicked button's value
      const dlg = window.IRIS.dialog({ title: 't', message: 'm', buttons: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] });
      await new Promise(r => setTimeout(r, 60));
      out.checks.dialogRenders = !!document.querySelector('.modal-card');
      const dbtns = document.querySelectorAll('.modal-actions [data-i]');
      if (dbtns[1]) dbtns[1].click();
      out.checks.dialogResolves = (await dlg) === 'b';

      // login as the seeded admin, then render the app shell
      const user = await window.IRIS.session.login({ email: 'admin@gmail.com', password: '1234' });
      out.checks.login = !!(user && user.email === 'admin@gmail.com');
      await window.IRIS.router.renderApp(user);
      await new Promise(r => setTimeout(r, 300));
      out.checks.tabsRendered = !!document.querySelector('.tab[data-tab="sources"]');

      // click Library + Assessment tabs; ensure they mount without throwing
      document.querySelector('.tab[data-tab="sources"]').click();
      await new Promise(r => setTimeout(r, 400));
      out.checks.libraryMounted = !!document.getElementById('library-root') || !!document.querySelector('.page-empty');
      document.querySelector('.tab[data-tab="assessment"]').click();
      await new Promise(r => setTimeout(r, 300));
      out.checks.assessmentMounted = !!document.querySelector('.assess-layout') || !!document.querySelector('.page-empty');

      // switch to the georeferenced project, then open Geography and verify the
      // map actually plots points + hull + EOO export
      window.IRIS.session.setCurrentProject(${geoPid});
      await new Promise(r => setTimeout(r, 200));

      // Overview infographic strip: KPIs + breakdown bars for the active project
      document.querySelector('.tab[data-tab="project"]').click();
      await new Promise(r => setTimeout(r, 600));
      out.checks.overviewStrip = !!document.querySelector('.ov .ov-kpis')
        && document.querySelector('.ov-name').textContent.trim().length > 0;
      out.checks.overviewBars = document.querySelectorAll('.ov .ov-bar-label').length >= 3;

      // Library rich-row view (default) with humanized field panels
      document.querySelector('.tab[data-tab="sources"]').click();
      await new Promise(r => setTimeout(r, 700));
      out.checks.rowsViewDefault = !!document.querySelector('.item-fullrow');
      // shared page header (gradient bar + mono label + serif name)
      out.checks.sharedHeader = !!document.querySelector('.page-hd-bar')
        && document.querySelector('.page-hd-label').textContent.trim() === 'Library'
        && document.querySelector('.page-hd-name').textContent.trim().length > 0;
      out.checks.rowsImage = !!document.querySelector('.fr-img') || !!document.querySelector('.fr-img-empty');
      out.checks.rowsFieldPanel = !!document.querySelector('.field-grid .field-row');
      out.checks.fieldsHumanized = [...document.querySelectorAll('.field-key')].some(k => k.textContent.trim() === 'Scientific Name');

      // Tag creation via the promptText modal (Electron window.prompt is unsupported)
      const newTagBtn = document.querySelector('#new-tag-btn');
      out.checks.newTagButton = !!newTagBtn;
      if (newTagBtn) {
        newTagBtn.click();
        await new Promise(r => setTimeout(r, 80));
        const modalInput = document.querySelector('#modal-input');
        out.checks.tagPromptOpens = !!modalInput;
        if (modalInput) {
          modalInput.value = 'SmokeTag';
          document.querySelector('#modal-root [data-ok]').click();
          await new Promise(r => setTimeout(r, 500));
          out.checks.tagCreated = [...document.querySelectorAll('.tag-chip')].some(c => c.textContent.includes('SmokeTag'));
        }
      }

      // Assessment: #{tag} citations become specimen links; hover shows a card
      document.querySelector('.tab[data-tab="assessment"]').click();
      await new Promise(r => setTimeout(r, 600));
      const links = document.querySelectorAll('.specimen-link');
      out.checks.citationLinks = links.length >= 3;   // #{MICH0}, #{geo_1}, #{MICH2}
      out.checks.citationText = [...links].some(a => a.textContent === 'MICH0');
      if (links[0]) {
        links[0].dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        await new Promise(r => setTimeout(r, 120));
      }
      out.checks.citationHovercard = !!document.querySelector('#spec-hovercard-root .geo-popup');
      window.IRIS.SpecimenCard.hideHover();

      // Master/detail: rail lists the seeded assessment, reading pane shows it
      out.checks.railListsAssessment = !!document.querySelector('.assess-rail-item');
      out.checks.detailShowsRun = !!document.querySelector('.assess-doc .assess-sections');

      // Builder: open it, verify quick-scope chips + item rows, apply a scope
      document.querySelector('#new-assess-btn').click();
      await new Promise(r => setTimeout(r, 150));
      out.checks.builderOpens = !!document.querySelector('.assess-builder');
      out.checks.builderScopeChips = document.querySelectorAll('.scope-chip').length >= 1;
      out.checks.builderItemRows = document.querySelectorAll('.builder-row').length >= 4;
      // click "All complete items" (first chip) → selects all 4 complete items
      document.querySelector('.scope-chip').click();
      await new Promise(r => setTimeout(r, 120));
      out.checks.builderScopeSelects = /(^|\\D)4(\\D|$)/.test((document.querySelector('.builder-count')||{}).textContent||'');
      out.checks.builderGenerateEnabled = !document.querySelector('[data-builder-generate]').disabled;
      // hand-pick toggle clears the active scope + updates count
      const firstPick = document.querySelector('.builder-list [data-pick]:not([disabled])');
      firstPick.checked = false; firstPick.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 80));
      out.checks.builderManualPick = /(^|\\D)3(\\D|$)/.test((document.querySelector('.builder-count')||{}).textContent||'');
      // cancel back to the reading pane
      document.querySelector('[data-builder-cancel]').click();
      await new Promise(r => setTimeout(r, 120));
      out.checks.builderCancels = !document.querySelector('.assess-builder') && !!document.querySelector('.assess-doc');

      // Inline rename: pencil → input → Save persists the new name to rail + head
      document.querySelector('[data-rename]').click();
      await new Promise(r => setTimeout(r, 100));
      const rin = document.querySelector('[data-rename-input]');
      out.checks.renameOpensInput = !!rin;
      rin.value = 'Renamed Assessment';
      document.querySelector('[data-rename-save]').click();
      await new Promise(r => setTimeout(r, 250));
      out.checks.renamePersists = (document.querySelector('.assess-name')||{}).textContent === 'Renamed Assessment'
        && [...document.querySelectorAll('.rail-name')].some(n => n.textContent === 'Renamed Assessment');

      // GBIF tab: embedded browser (webview) + Add-to-Library control mount
      out.checks.gbifApi = !!(window.IRIS.api.gbif && window.IRIS.api.gbif.getOccurrence && window.IRIS.api.gbif.saveImport);
      document.querySelector('.tab[data-tab="gbif"]').click();
      await new Promise(r => setTimeout(r, 350));
      out.checks.gbifWebview = !!document.querySelector('webview.gbif-view');
      out.checks.gbifAddButton = !!document.querySelector('#gbif-add');
      // GBIF header uses the shared style + browser nav on its own chrome row
      out.checks.gbifSharedHeader = document.querySelector('.gbif-toolbar .page-hd-label').textContent.trim() === 'GBIF';
      out.checks.gbifChromeRow = !!document.querySelector('.gbif-chrome #gbif-url');
      // Add is disabled until a specimen occurrence page is open
      out.checks.gbifAddDisabled = document.querySelector('#gbif-add').disabled === true;
      // split "Bookmark this Search" button (+ caret) present
      out.checks.gbifBookmarkSplit = !!document.querySelector('#gbif-bm-add') && !!document.querySelector('#gbif-bm-toggle');
      // bulk "Import…" control + hidden progress card present; enumerate API wired
      out.checks.gbifImportBtn = !!document.querySelector('#gbif-import') && !!document.querySelector('#gbif-progress');
      out.checks.gbifEnumerateApi = !!(window.IRIS.api.gbif && window.IRIS.api.gbif.enumerateSearch);
      // import dialog lists the already-in-library GBIF IDs (dedup before download)
      window.IRIS.GbifPage._promptImport({ total: 3, found: 3, pending: 2, already: 1, alreadyIds: ['5900885383'], capped: false });
      await new Promise(r => setTimeout(r, 60));
      const dupBox = document.querySelector('.gbif-dups');
      out.checks.gbifDupList = !!dupBox && dupBox.textContent.includes('5900885383') && !!document.querySelector('.dup-id');
      document.querySelector('#modal-root [data-act="cancel"]').click();
      await new Promise(r => setTimeout(r, 30));
      out.checks.gbifDupDialogCloses = !document.querySelector('.gbif-dups');
      // dropdown lists the seeded saved search
      document.querySelector('#gbif-bm-toggle').click();
      await new Promise(r => setTimeout(r, 80));
      const bmItem = document.querySelector('#gbif-bm-menu .split-menu-item');
      out.checks.gbifBookmarkMenu = !!bmItem && !document.querySelector('#gbif-bm-menu').hidden;
      out.checks.gbifBookmarkLabel = !!bmItem && bmItem.textContent.includes('Acer');
      document.querySelector('#gbif-bm-toggle').click(); // close

      // References tab: lists the seeded GBIF occurrence as a reference row
      document.querySelector('.tab[data-tab="references"]').click();
      await new Promise(r => setTimeout(r, 300));
      const refRow = document.querySelector('.ref-row');
      out.checks.referencesRow = !!refRow;
      out.checks.referencesId = !!refRow && refRow.textContent.includes('5900885383');
      out.checks.referencesCitation = !!document.querySelector('.ref-citation')
        && document.querySelector('.ref-citation').textContent.includes('accessed via GBIF.org');
      out.checks.referencesBadge = !!document.querySelector('.ref-badge');

      // Split export button + the three format options are present and wired.
      out.checks.refExportSplit = !!document.querySelector('#ref-export-main')
        && document.querySelectorAll('#ref-export-menu [data-export]').length === 3;
      const exOpen = document.querySelector('#ref-export-toggle');
      if (exOpen) { exOpen.click(); await new Promise(r => setTimeout(r, 40)); }
      out.checks.refExportMenuOpens = !document.querySelector('#ref-export-menu').hidden;
      if (exOpen) exOpen.click();

      document.querySelector('.tab[data-tab="geography"]').click();
      await new Promise(r => setTimeout(r, 900));
      out.checks.geographyMounted = !!document.querySelector('.geo-map');
      out.checks.mapInitialized = !!document.querySelector('.leaflet-container');
      // map must be a contained stacking context (z:0) so app modals sit above it
      out.checks.mapContained = getComputedStyle(document.querySelector('.geo-map')).zIndex === '0';
      // circleMarkers + hull polygon are SVG paths (4 markers + 1 polygon ≥ 5)
      out.checks.markersAndHull = document.querySelectorAll('.leaflet-overlay-pane path').length >= 5;
      const eoo = document.querySelector('.eoo-num');
      out.checks.eooArea = !!eoo && parseFloat(eoo.textContent.replace(/,/g,'')) > 0;
      const wkt = [...document.querySelectorAll('.fmt-text')].map(t => t.value).join(' ');
      out.checks.formatsExported = wkt.includes('POLYGON((') && wkt.includes('"type":"Polygon"');

      // open a marker popup and confirm it renders at the doubled width
      const paths = document.querySelectorAll('.leaflet-overlay-pane path.leaflet-interactive');
      const marker = paths[paths.length - 1];   // last path is a point marker
      if (marker) { marker.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await new Promise(r => setTimeout(r, 250)); }
      const pc = document.querySelector('.leaflet-popup-content');
      out.checks.mapPopupWide = !!pc && pc.getBoundingClientRect().width >= 480;

      // Exclude-from-polygon: popup button toggles the tag + recomputes the hull
      const exBtn = pc && pc.querySelector('.excl-btn[data-exclude]');
      out.checks.geoExcludeButton = !!exBtn && /Exclude from polygon/.test(exBtn.textContent);
      if (exBtn) { exBtn.click(); await new Promise(r => setTimeout(r, 450)); }
      out.checks.geoExcludeToggles = !!exBtn && /Include in polygon/.test(exBtn.textContent);
      out.checks.geoExcludeApplied = ((document.getElementById('geo-side') || {}).textContent || '').includes('excluded');

      // lightbox: opens fullscreen zoomable viewer and closes cleanly
      out.checks.lightboxLoaded = !!(window.IRIS && window.IRIS.Lightbox);
      window.IRIS.Lightbox.open({ images: [
        { key: 'original', label: 'Original', src: 'iris-source://source/1' },
        { key: 'cropped', label: 'Crop', src: 'iris-source://source/1' },
      ], activeKey: 'original', title: 'Test' });
      await new Promise(r => setTimeout(r, 150));
      out.checks.lightboxOpens = !!document.getElementById('lightbox-img') && !!document.getElementById('lightbox-stage');
      // opened over the map → must stack above every Leaflet pane/control
      const lbZ = parseInt(getComputedStyle(document.getElementById('lightbox')).zIndex, 10) || 0;
      let leafMax = 0;
      document.querySelectorAll('.leaflet-pane, .leaflet-control, .leaflet-top, .leaflet-bottom, .leaflet-container').forEach(el => {
        const z = parseInt(getComputedStyle(el).zIndex, 10);
        if (!isNaN(z)) leafMax = Math.max(leafMax, z);
      });
      out.checks.lightboxAboveMap = lbZ > leafMax && lbZ >= 5000;

      // pan: zoom in (wheel), then drag — transform must gain a nonzero translate
      const stg = document.getElementById('lightbox-stage');
      const limg = document.getElementById('lightbox-img');
      stg.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, clientX: 640, clientY: 420, bubbles: true, cancelable: true }));
      const zoomed = !(limg.style.transform || '').includes('scale(1)');   // scale != exactly 1
      limg.dispatchEvent(new MouseEvent('mousedown', { clientX: 640, clientY: 420, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 700, clientY: 460, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      // drag again to prove listeners survive the first drag (the old bug)
      limg.dispatchEvent(new MouseEvent('mousedown', { clientX: 700, clientY: 460, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 720, clientY: 470, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      // parse "translate(80px, 56px)" without a regex (template literal would
      // otherwise eat the backslashes)
      const tr = (limg.style.transform || '').split('translate(')[1] || '';
      const nums = tr.split(')')[0].split(',').map(s => parseFloat(s));
      const panned = nums.length === 2 && (Math.abs(nums[0]) > 1 || Math.abs(nums[1]) > 1);
      out.checks.lightboxPans = zoomed && panned;

      window.IRIS.Lightbox.close();
      await new Promise(r => setTimeout(r, 50));
      out.checks.lightboxCloses = !document.getElementById('lightbox-img');
    } catch (e) { out.errors.push(String(e && e.stack || e)); }
    out.pageErrs = window.__errs || [];
    return out;
  })()`);
  if (report.pageErrs && report.pageErrs.length) {
    console.log('--- page error stacks ---');
    report.pageErrs.forEach(s => console.log(s));
  }

  console.log('--- renderer checks ---');
  for (const [k, v] of Object.entries(report.checks)) console.log(`  ${v ? '✓' : '✗'} ${k}`);
  const failed = Object.entries(report.checks).filter(([, v]) => !v).map(([k]) => k);
  const pageErrors = errors.concat(report.errors);
  if (pageErrors.length) { console.log('--- errors ---'); pageErrors.forEach(e => console.log('  ' + e)); }

  dbConn.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  const ok = failed.length === 0 && pageErrors.length === 0;
  console.log(ok ? '\nRENDERER BOOT OK' : `\nRENDERER BOOT FAILED (${failed.join(', ')})`);
  app.exit(ok ? 0 : 1);
});
