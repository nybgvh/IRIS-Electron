// Integration smoke for the item pipeline: upload -> downsample -> (mocked)
// VoucherVisionGO -> split ocr/formatted_json + 3 JPGs -> Library item ->
// tags -> summary prompt -> reprocess -> delete cascade -> move.
//
// Run with the Electron-bundled Node so better-sqlite3 + sharp have the right
// ABI:
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/smoke-pipeline.js
//
// No live VVGO / Gemini calls — the HTTP client is mocked so the queue's real
// artifact-splitting code runs against a canned response.

const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

// Enable the VV + aggregation integrations BEFORE requiring config modules.
process.env.VV_API_BASE_URL = 'http://mock.local';
process.env.VV_API_KEY = 'mock-key';
process.env.VV_TICK_MS = '50';
process.env.GEMINI_API_KEY = 'mock-gemini-key';

const sharp = require('sharp');
const dbConn = require('../src/server/db/connection');
const { runMigrations } = require('../src/server/db/migrate');
const { runSeed } = require('../src/server/db/seed');
const authService = require('../src/server/services/auth-service');
const projectService = require('../src/server/services/project-service');
const sourceService = require('../src/server/services/source-service');
const vvService = require('../src/server/services/vouchervision-service');
const itemService = require('../src/server/services/item-service');
const tagService = require('../src/server/services/tag-service');
const assessmentService = require('../src/server/services/assessment-service');
const fileStore = require('../src/server/storage/file-store');
const vvRepo = require('../src/server/repositories/vouchervision-repo');
const { RedListPrompt, parseSections, RETURN_SCHEMA } = require('../src/server/aggregation/prompt');

// Mock the HTTP client BEFORE the queue is required (queue captures the same
// module object; overwriting .submit is seen by the queue).
const vvClient = require('../src/server/vouchervision/client');
// Mock the Gemini aggregation provider so no live LLM call is made.
const geminiProvider = require('../src/server/aggregation/gemini-provider');

function pass(msg) { console.log('  ✓', msg); }

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-pipe-'));
  fileStore.init(tmp);
  dbConn.init(':memory:');
  runMigrations();
  runSeed();

  const { token } = await authService.login({ email: 'admin@gmail.com', password: '1234' });
  const user = authService.userFromToken(token);
  const project = projectService.create(user, { name: 'Pipeline Test' });
  console.log('project', project.id);

  // --- 1. Upload a 24 MP image → expect a ≤20 MP JPEG on disk ---------------
  const bigPng = await sharp({ create: { width: 6000, height: 4000, channels: 3, background: { r: 40, g: 120, b: 60 } } })
    .png().toBuffer();
  const src = await sourceService.upload(user, project.id, {
    filename: 'specimen_A.png',
    mime_type: 'image/png',
    buffer: bigPng,
    source_type: 'image',
  });
  assert.strictEqual(src.mime_type, 'image/jpeg', 'stored as jpeg');
  assert.ok(src.filename.endsWith('.jpg'), 'filename retargeted to .jpg');
  const mp = (src.metadata.width * src.metadata.height) / 1e6;
  assert.ok(mp <= 20 && mp > 19, `downsampled to ~20MP (${mp.toFixed(2)})`);
  const storedAbs = fileStore.resolve(src.storage_path);
  assert.ok(fs.existsSync(storedAbs), 'stored file exists');
  pass(`upload downsampled 24MP → ${mp.toFixed(2)}MP jpg`);

  // A pending vv record should have been auto-enqueued (VV is "configured").
  let rec = vvRepo.findBySource(src.id);
  assert.ok(rec && rec.status === 'pending', 'vv record pending after upload');
  pass('vv record auto-enqueued as pending');

  // --- 1b. Duplicate-upload detection ---------------------------------------
  const crypto = require('crypto');
  const rawHash = crypto.createHash('sha256').update(bigPng).digest('hex');
  assert.strictEqual(src.upload_sha256, rawHash, 'source stores the raw-upload hash');
  // same file again, no force → returns the existing item (no new row/queue)
  const dup = await sourceService.upload(user, project.id, {
    filename: 'specimen_A.png', mime_type: 'image/png', buffer: bigPng, source_type: 'image',
  });
  assert.strictEqual(dup.id, src.id, 'non-forced re-upload returns the existing item');
  assert.deepStrictEqual(sourceService.checkDuplicates(user, project.id, [rawHash]), [rawHash], 'checkDuplicates reports the known hash');
  assert.deepStrictEqual(sourceService.checkDuplicates(user, project.id, ['deadbeef']), [], 'checkDuplicates ignores unknown hashes');
  // force → a NEW distinct item with its own file
  const forced = await sourceService.upload(user, project.id, {
    filename: 'specimen_A.png', mime_type: 'image/png', buffer: bigPng, source_type: 'image', force: true,
  });
  assert.notStrictEqual(forced.id, src.id, 'forced re-upload creates a new item');
  assert.notStrictEqual(forced.storage_path, src.storage_path, 'forced duplicate gets its own file');
  sourceService.remove(user, forced.id);   // keep later counts clean
  pass('duplicate detection: dedup by default, checkDuplicates works, force creates a new item');

  // --- 2. Drive the queue with a mocked VVGO /process response --------------
  const fullB64 = (await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 10, g: 10, b: 200 } } }).jpeg().toBuffer()).toString('base64');
  const cropB64 = (await sharp({ create: { width: 600, height: 200, channels: 3, background: { r: 220, g: 220, b: 10 } } }).jpeg().toBuffer()).toString('base64');
  vvClient.submit = async () => ({
    ocr: 'Carissa spinarum L. Kenya, Nairobi. Shrub in dry bushland. 1600 m.',
    formatted_json: { scientificName: 'Carissa spinarum', country: 'Kenya',
      stateProvince: 'Nairobi', habitat: 'dry bushland', minimumElevationInMeters: '1600' },
    collage_info: {
      base64image_input_resized: fullB64,
      base64image_text_collage: cropB64,
    },
    collage_image_format: 'jpeg',
    ocr_info: { 'gemini': { tokens_in: 100, tokens_out: 50, total_cost: 0.0001 } },
  });

  const vvQueue = require('../src/server/vouchervision/queue');
  vvQueue.start();
  await waitFor(() => vvRepo.findById(rec.id).status === 'complete', 4000);
  vvQueue.stop();

  rec = vvRepo.findById(rec.id);
  assert.strictEqual(rec.status, 'complete', 'record complete');
  assert.strictEqual(rec.scientific_name, 'Carissa spinarum', 'scientific_name split out');
  assert.ok(rec.ocr_text && rec.ocr_text.includes('Carissa'), 'ocr_text stored');
  assert.ok(rec.formatted && rec.formatted.country === 'Kenya', 'formatted_json parsed');
  assert.ok(rec.image_full_path && fs.existsSync(fileStore.resolve(rec.image_full_path)), 'full JPG on disk');
  assert.ok(rec.image_cropped_path && fs.existsSync(fileStore.resolve(rec.image_cropped_path)), 'cropped JPG on disk');
  // The persisted response JSON should have base64 stripped.
  const rawJson = JSON.parse(fs.readFileSync(fileStore.resolve(rec.storage_path), 'utf8'));
  assert.ok(!rawJson.collage_info.base64image_input_resized, 'base64 stripped from provenance JSON');
  pass('queue split ocr + formatted_json + 2 derived JPGs (3rd is the original)');

  // --- 3. Item read model ---------------------------------------------------
  let items = itemService.list(user, project.id, {});
  assert.strictEqual(items.length, 1, 'one item');
  const it = items[0];
  assert.strictEqual(it.vv_status, 'complete');
  assert.ok(it.has_full_image && it.has_cropped_image, 'item flags both images');
  assert.strictEqual(it.scientific_name, 'Carissa spinarum');
  assert.ok((it.tags || []).some(t => t.name === 'User Upload'), 'direct upload auto-tagged "User Upload"');
  pass('item read model joins source + extraction');

  // status + search facets
  assert.strictEqual(itemService.list(user, project.id, { status: 'complete' }).length, 1);
  assert.strictEqual(itemService.list(user, project.id, { status: 'errored' }).length, 0);
  assert.strictEqual(itemService.list(user, project.id, { search: 'carissa' }).length, 1);
  assert.strictEqual(itemService.list(user, project.id, { search: 'zzz' }).length, 0);
  pass('status + search facets filter correctly');

  // --- 4. Tags --------------------------------------------------------------
  const tag = tagService.create(user, project.id, { name: 'Type Specimen', color: '#3b7a57' });
  tagService.assign(user, src.id, tag.id);
  items = itemService.list(user, project.id, {});
  assert.ok(items[0].tags.some(t => t.name === 'Type Specimen'), 'item shows the assigned tag');
  assert.strictEqual(itemService.list(user, project.id, { tagId: tag.id }).length, 1, 'tag facet');
  const tagsList = tagService.list(user, project.id);
  const typeTag = tagsList.find(t => t.name === 'Type Specimen');
  assert.strictEqual(typeTag.usage_count, 1, 'tag usage count');
  pass('tag create + assign + facet + usage count');

  // --- 5. Summary prompt (RedListPrompt class + JSON parse) ------------------
  const prompt = new RedListPrompt(items).build();
  assert.ok(prompt.includes('Carissa spinarum'), 'prompt embeds record');
  assert.ok(prompt.includes('"Geographic_Range"'), 'prompt includes RETURN_SCHEMA');
  const parsed = parseSections(JSON.stringify({
    Taxonomy: 'Carissa spinarum L.', Geographic_Range: 'Kenya.', Habitat: 'Dry bushland.',
    Ecology: 'Shrub.', Use_and_Trade: 'None.', Threats_and_Conservation_Actions: 'Grazing.',
  }));
  assert.strictEqual(parsed.Geographic_Range, 'Kenya.', 'JSON sections parsed by schema key');
  assert.deepStrictEqual(Object.keys(parsed), Object.keys(RETURN_SCHEMA), 'all schema keys present');
  // fenced-json fallback
  assert.strictEqual(parseSections('```json\n{"Habitat":"Forest."}\n```').Habitat, 'Forest.', 'fenced JSON fallback');
  pass('RedListPrompt build + RETURN_SCHEMA JSON parse (+ fenced fallback)');

  // --- 5b. Versioned, rerunnable summary on SELECTED items ------------------
  let genCalls = 0;
  geminiProvider.summarize = async ({ prompt: p }) => {
    genCalls++;
    assert.ok(p.includes('Carissa spinarum'), 'provider received prompt with record');
    return { text: JSON.stringify({
      Taxonomy: `Run ${genCalls}: Carissa spinarum.`, Geographic_Range: 'Kenya (Nairobi).',
      Habitat: 'Dry bushland.', Ecology: 'Shrub.', Use_and_Trade: 'None.',
      Threats_and_Conservation_Actions: 'Grazing.',
    }), model: 'gemini-mock' };
  };
  // requires an explicit selection
  await assertThrows(() => assessmentService.generateSummary(user, project.id, { sourceIds: [] }),
    'refuses empty selection');
  const run1 = await assessmentService.generateSummary(user, project.id, { sourceIds: [src.id] });
  assert.strictEqual(run1.version, 1, 'first run is version 1');
  assert.strictEqual(run1.series_id, run1.id, 'series points at itself');
  assert.strictEqual(run1.payload.sections.Geographic_Range, 'Kenya (Nairobi).', 'sections stored');
  assert.strictEqual(run1.payload.record_count, 1, 'record count stored');
  // rerun reuses the prior selection and appends version 2 in the same series
  const run2 = await assessmentService.generateSummary(user, project.id, { rerunOf: run1.id });
  assert.strictEqual(run2.version, 2, 'rerun is version 2');
  assert.strictEqual(run2.series_id, run1.id, 'rerun shares series');
  assert.ok(run2.payload.sections.Taxonomy.includes('Run 2'), 'rerun produced a new result');
  const runs = assessmentService.list(user, project.id);
  assert.strictEqual(runs.length, 2, 'both versions retained');
  assert.strictEqual(genCalls, 2, 'provider called once per run');
  pass('summary generate on selection + rerun keeps versions (v1, v2 in one series)');

  // --- 5c. Flag toggle (shared per-item marker) -----------------------------
  await sourceService.setFlag(user, src.id, true);
  assert.strictEqual(itemService.list(user, project.id, {})[0].flagged, true, 'item reads flagged=true');
  await sourceService.setFlag(user, src.id, false);
  assert.strictEqual(itemService.list(user, project.id, {})[0].flagged, false, 'item reads flagged=false');
  pass('flag toggles and surfaces on the item read model');

  // --- 6. Dashboard summary -------------------------------------------------
  const summary = itemService.summary(user, project.id);
  assert.strictEqual(summary.totals.items, 1);
  assert.strictEqual(summary.totals.images, 1, 'direct specimen upload counts as a specimen');
  assert.strictEqual(summary.vouchervision.complete, 1);
  assert.strictEqual(summary.provenance.upload, 1, 'user upload counted in provenance');
  assert.strictEqual(summary.provenance.gbif, 0, 'no GBIF imports in provenance');
  assert.strictEqual(typeof summary.georeferenced, 'number', 'georeferenced count present');
  pass('project summary counts (+ provenance + georeferenced)');

  // --- 7. Reprocess clears + re-runs ---------------------------------------
  vvClient.submit = async () => ({ ocr: 'REDO', formatted_json: { scientificName: 'Redo sp.' },
    collage_info: { base64image_input_resized: fullB64, base64image_text_collage: cropB64 } });
  vvQueue.start();
  vvService.reprocess(user, src.id);
  await waitFor(() => { const r = vvRepo.findBySource(src.id); return r && r.status === 'complete' && r.scientific_name === 'Redo sp.'; }, 4000);
  vvQueue.stop();
  assert.strictEqual(vvRepo.findBySource(src.id).scientific_name, 'Redo sp.', 'reprocess overwrote extraction');
  pass('reprocess clears + re-runs');

  // --- 8. Move to another project (tags drop) -------------------------------
  const project2 = projectService.create(user, { name: 'Dest Project' });
  const moved = sourceService.move(user, src.id, project2.id);
  assert.strictEqual(moved.project_id, project2.id, 'source re-keyed');
  assert.strictEqual(vvRepo.findBySource(src.id).project_id, project2.id, 'vv record re-keyed');
  assert.strictEqual(itemService.list(user, project2.id, {})[0].tags.length, 0, 'tags dropped on move');
  assert.ok(fs.existsSync(fileStore.resolve(moved.storage_path)), 'file moved on disk');
  pass('move re-keys source + vv + relocates file + drops tags');

  // --- 9. Delete cascade cleans artifacts ----------------------------------
  const recBefore = vvRepo.findBySource(src.id);
  const fullBefore = fileStore.resolve(recBefore.image_full_path);
  sourceService.remove(user, src.id);
  assert.strictEqual(vvRepo.findBySource(src.id), null, 'vv record removed');
  assert.ok(!fs.existsSync(fullBefore), 'derived JPG cleaned up');
  assert.ok(!fs.existsSync(fileStore.resolve(moved.storage_path)), 'source file cleaned up');
  pass('delete cascades source + vv rows + on-disk artifacts');

  // --- 10. PDF explodes into per-page image items (in-app rasterisation) -----
  const pdfProject = projectService.create(user, { name: 'PDF Test' });
  // Capture every /process call so we can assert the wire options per page.
  // The real API returns an EMPTY formatted_json for ocr_only submissions — mimic
  // that so we verify the queue normalizes it and the record is OCR-only.
  const submitCalls = [];
  vvClient.submit = async ({ filename, options }) => {
    submitCalls.push({ filename, options });
    return { ocr: `ocr ${filename}`, formatted_json: '', collage_info: {} };
  };
  const pdfRes = await sourceService.upload(user, pdfProject.id, {
    filename: 'field_notes.pdf', mime_type: 'application/pdf', buffer: makeTestPdf(), source_type: 'pdf',
  });
  assert.ok(pdfRes && pdfRes.pdf, 'PDF upload returns a pdf result');
  assert.strictEqual(pdfRes.pageCount, 2, 'PDF exploded into 2 page items');
  const pageIds = pdfRes.pages.map(p => p.id);
  const pageItems = itemService.list(user, pdfProject.id, {});
  assert.strictEqual(pageItems.length, 2, 'two library items created');
  assert.ok(pageItems.every(it => it.source_type === 'image'), 'pages are IMAGE items (not pdf)');
  assert.ok(pageItems.every(it => (it.metadata || {}).origin === 'pdf' && (it.metadata || {}).source_pdf === 'field_notes.pdf'), 'pages record their PDF origin + page number');
  assert.ok(pageIds.every(sid => { const r = vvRepo.findBySource(sid); return r && r.status === 'pending'; }), 'each page auto-enqueued a vv record');
  // the queue processes each page as an ordinary image (in parallel)
  vvQueue.start();
  await waitFor(() => pageIds.every(sid => { const r = vvRepo.findBySource(sid); return r && r.status === 'complete'; }), 6000);
  vvQueue.stop();
  assert.ok(pageIds.every(sid => vvRepo.findBySource(sid).status === 'complete'), 'every page processed via the image path');
  // PDF pages must be submitted OCR-only with the collage skipped (fixes the
  // "No collage could be created" 500 on document pages).
  assert.strictEqual(submitCalls.length, 2, 'both pages submitted to /process');
  assert.ok(submitCalls.every(c => c.options && c.options.ocrOnly === true && c.options.skipLabelCollage === true),
    'PDF pages submitted with ocr_only + skip_label_collage');
  // Empty formatted_json from an OCR-only submit normalizes to null; OCR is kept.
  const doneItems = itemService.list(user, pdfProject.id, {});
  assert.ok(doneItems.every(it => it.formatted == null), 'OCR-only pages store no structured formatted_json');
  assert.ok(doneItems.every(it => it.ocr_text && it.ocr_text.startsWith('ocr ')), 'OCR-only pages keep their OCR text');
  assert.ok(doneItems.every(it => (it.tags || []).some(t => t.name === 'User Upload')), 'PDF pages auto-tagged "User Upload"');
  pass('PDF rasterised in-app → per-page image items → submitted OCR-only (collage skipped) → OCR kept, no fields');

  // --- 11. OCR-only records feed the assessment as full OCR text -------------
  const ocrPrompt = new RedListPrompt(doneItems);
  const ocrRecords = ocrPrompt.records;
  assert.ok(ocrRecords.every(r => r.ocr_only === true), 'PDF-page records flagged ocr_only in the prompt');
  assert.ok(ocrRecords.every(r => typeof r.ocr_text === 'string' && r.ocr_text.length > 0), 'OCR-only records carry the full OCR text');
  assert.ok(ocrRecords.every(r => !('scientificName' in r) && !('country' in r)), 'OCR-only records omit the empty structured fields');
  assert.ok(ocrRecords.every(r => typeof r.tag === 'string' && r.tag.startsWith('#{')), 'OCR-only records still carry a citation tag');
  assert.ok(ocrPrompt.build().includes('ocr field_notes'), 'built prompt embeds the page OCR text');
  pass('OCR-only records (RECORD_FIELDS_OCR_ONLY) send full OCR to the assessment tools');

  // --- 12. Type facets / dashboard count by upload ORIGIN, not stored file ---
  // Every page is stored as source_type 'image', so counts must come from the
  // upload origin (metadata.origin) or PDFs/notebooks would read as specimens.
  const pdfSummary = itemService.summary(user, pdfProject.id);
  assert.strictEqual(pdfSummary.totals.items, 2, 'both PDF pages counted');
  assert.strictEqual(pdfSummary.totals.pdfs, 2, 'PDF-origin pages counted as PDFs');
  assert.strictEqual(pdfSummary.totals.notebooks, 0, 'no notebook-origin pages');
  assert.strictEqual(pdfSummary.totals.images, 0, 'PDF pages NOT counted as specimens');
  pass('dashboard + type facets count by upload origin (not stored file type)');

  // --- 13. GBIF import: metadata via API, image bytes via the browser --------
  // The renderer downloads the image through the webview (browser session) and
  // hands the bytes to saveImport; only GBIF's JSON API is fetched server-side.
  // We mock global.fetch (occurrence + dataset) and pass a real JPEG as bytes.
  const gbifService = require('../src/server/services/gbif-service');
  const OCC = {
    key: 5900885383, datasetKey: 'ds-1', scientificName: 'Acer negundo var. interius (Britton) Sarg.',
    country: 'United States of America', decimalLatitude: 43.285498, decimalLongitude: -102.153161,
    catalogNumber: 'CSCN-V-0059095', family: 'Sapindaceae',
    media: [{ identifier: 'https://ngpherbaria.org/media/ngph/CSCN/CSCN-V-0059/CSCN-V-0059095.jpg', type: 'StillImage', format: 'image/jpeg' }],
  };
  const DATASET = {
    title: 'Chadron State College, High Plains Herbarium', doi: '10.15468/wrrrke',
    citation: { text: 'High Plains Herbarium at Chadron State College (2026). Chadron State College, High Plains Herbarium. Occurrence dataset https://doi.org/10.15468/wrrrke accessed via GBIF.org on 2026-07-07.' },
  };
  // Search API page for the bulk-enumerate test (two imaged occurrences).
  const SEARCH_PAGE = {
    count: 2, endOfRecords: true, limit: 300, offset: 0,
    results: [
      { key: 111, scientificName: 'Acer negundo', media: [{ identifier: 'https://inst.example/111.jpg', type: 'StillImage' }] },
      { key: 222, scientificName: 'Acer negundo', media: [{ identifier: 'https://inst.example/222.jpg', type: 'StillImage' }] },
    ],
  };
  const realFetch = global.fetch;
  const jres = (obj) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => obj });
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/occurrence/search')) return jres(SEARCH_PAGE);
    if (u.includes('/occurrence/5900885383')) return jres(OCC);
    if (u.includes('/occurrence/111')) return jres({ key: 111, datasetKey: 'ds-1', scientificName: 'Acer negundo', media: [{ identifier: 'https://inst.example/111.jpg', type: 'StillImage' }] });
    if (u.includes('/dataset/ds-1')) return jres(DATASET);
    throw new Error('unexpected fetch in test: ' + u);
  };
  try {
    const gbifProject = projectService.create(user, { name: 'GBIF Test' });
    const jpegBuf = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 12, g: 84, b: 71 } } }).jpeg().toBuffer();
    const dataUrl = 'data:image/jpeg;base64,' + jpegBuf.toString('base64');

    // getOccurrence: reads id from a gallery URL (entity=o_ID), builds citation
    const meta = await gbifService.getOccurrence(user, gbifProject.id,
      'https://www.gbif.org/occurrence/search?view=GALLERY&entity=o_5900885383');
    assert.strictEqual(meta.gbif_id, '5900885383', 'occurrence id parsed from gallery URL');
    assert.ok(meta.image_url.includes('ngpherbaria.org'), 'image identifier is the institution URL');
    assert.strictEqual(meta.citation,
      DATASET.citation.text + ' https://gbif.org/occurrence/5900885383', 'citation = dataset text + occurrence URL');
    assert.strictEqual(meta.duplicate, false, 'not yet imported');

    // saveImport with browser-fetched bytes → Library item + gbif reference row
    const row = await gbifService.saveImport(user, gbifProject.id, '5900885383', dataUrl);
    assert.ok(row.imported && row.gbif_id === '5900885383', 'import committed');
    assert.strictEqual(row.scientific_name, OCC.scientificName, 'scientific name stored');
    const gitems = itemService.list(user, gbifProject.id, {});
    const gimg = gitems.find(it => it.filename === 'GBIF_5900885383.jpg');
    assert.ok(gimg, 'image saved to Library as GBIF_<id>.jpg');
    assert.strictEqual((gimg.metadata || {}).imported_from, 'gbif', 'library item marked imported_from gbif');
    assert.ok((gimg.tags || []).some(t => t.name === 'GBIF'), 'GBIF import auto-tagged "GBIF"');

    // idempotent per project
    const dup = await gbifService.saveImport(user, gbifProject.id, '5900885383', dataUrl);
    assert.ok(dup.duplicate, 'second import of same occurrence dedups');
    assert.strictEqual(gbifService.list(user, gbifProject.id).length, 1, 'one reference row');

    // remove the reference — the imported image stays in the Library
    gbifService.remove(user, row.id);
    assert.strictEqual(gbifService.list(user, gbifProject.id).length, 0, 'reference removed');
    assert.ok(itemService.list(user, gbifProject.id, {}).some(it => it.filename === 'GBIF_5900885383.jpg'),
      'imported image remains after the reference is removed');
    pass('GBIF import: API metadata + browser-supplied bytes → Library item + citation row (+ dedup)');

    // --- 14. GBIF saved searches (bookmarks) ---------------------------------
    const bmUrl = 'https://www.gbif.org/occurrence/search?q=Acer%20negundo&view=GALLERY';
    const bm = await gbifService.bookmarkSearch(user, gbifProject.id, bmUrl);
    assert.ok(bm.id, 'bookmark created');
    assert.ok(bm.label.includes('Acer'), 'bookmark label derived from the search query');
    const bmDup = await gbifService.bookmarkSearch(user, gbifProject.id, bmUrl);
    assert.ok(bmDup.duplicate, 'same search URL deduped');
    assert.strictEqual(gbifService.listBookmarks(user, gbifProject.id).length, 1, 'one saved search listed');
    gbifService.removeBookmark(user, bm.id);
    assert.strictEqual(gbifService.listBookmarks(user, gbifProject.id).length, 0, 'saved search removed');
    pass('GBIF bookmarks: save current search (deduped, labelled) + list + remove');

    // --- 15. Bulk enumerate: paginate the search API for all imaged records ---
    const en = await gbifService.enumerateSearch(user, gbifProject.id,
      'https://www.gbif.org/occurrence/search?q=Acer&view=GALLERY&basisOfRecord=PRESERVED_SPECIMEN');
    assert.strictEqual(en.total, 2, 'search total reported');
    assert.strictEqual(en.occurrences.length, 2, 'both imaged occurrences enumerated');
    assert.ok(en.occurrences.every(o => o.image_url && o.gbif_id), 'each enumerated occurrence has an id + image url');
    // 5900885383 was imported+removed above (row gone) so nothing here is a dup
    assert.ok(en.occurrences.every(o => o.already_imported === false), 'dedup flags computed');
    assert.strictEqual(en.capped, false, 'not capped when total fits');
    // when the search matches far more than the cap, capped flag is set
    SEARCH_PAGE.count = 999999;
    const capProj = projectService.create(user, { name: 'GBIF Cap' });
    const enBig = await gbifService.enumerateSearch(user, capProj.id, 'https://www.gbif.org/occurrence/search?q=x');
    assert.ok(enBig.capped, 'capped flag set when the search exceeds the 500 cap');
    SEARCH_PAGE.count = 2;
    pass('GBIF bulk enumerate: paginate search API → imaged occurrences (id + image url + dedup flags + cap)');

    // --- 16. GBIF web URL → API URL: CoL-XR checklistKey + param cleanup -----
    // gbif.org uses Catalogue of Life XR keys (alphanumeric, e.g. 4J2JZ = Pinus
    // torreyana); the occurrence API needs the checklistKey to resolve them.
    const apiUrl = gbifService._buildSearchApiUrl(
      'https://www.gbif.org/occurrence/search?taxonKey=4J2JZ&basisOfRecord=PRESERVED_SPECIMEN&view=gallery&_CfChlFTk=abc',
      { limit: 300, offset: 0 });
    assert.ok(apiUrl.includes('taxonKey=4J2JZ'), 'alphanumeric taxonKey forwarded verbatim (not decoded)');
    assert.ok(apiUrl.includes('checklistKey=7ddf754f-d193-4cc9-b351-99906754a03b'), 'CoL-XR checklistKey added for alphanumeric taxon key');
    assert.ok(apiUrl.includes('mediaType=StillImage'), 'built API URL forces StillImage');
    assert.ok(apiUrl.includes('basisOfRecord=PRESERVED_SPECIMEN'), 'real filters forwarded');
    assert.ok(!apiUrl.includes('_CfChlFTk') && !/[?&]view=/.test(apiUrl), 'UI-only + Cloudflare params dropped');
    // A numeric (classic backbone) taxon key must NOT get the CoL checklistKey.
    const apiUrlNum = gbifService._buildSearchApiUrl(
      'https://www.gbif.org/occurrence/search?taxonKey=212', { limit: 300, offset: 0 });
    assert.ok(apiUrlNum.includes('taxonKey=212') && !apiUrlNum.includes('checklistKey'),
      'numeric backbone taxonKey queried against the default backbone (no checklistKey)');
    pass('GBIF search URL translation: CoL-XR checklistKey for alphanumeric keys, backbone for numeric');

    // --- 17. Dup detection before download: enumerate flags imported ids ------
    // Distinct bytes from 5900885383 so the upload-hash dedup makes a new source.
    const jpeg111 = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 200, g: 100, b: 50 } } }).jpeg().toBuffer();
    await gbifService.saveImport(user, gbifProject.id, '111', 'data:image/jpeg;base64,' + jpeg111.toString('base64'));
    const en3 = await gbifService.enumerateSearch(user, gbifProject.id, 'https://www.gbif.org/occurrence/search?q=Acer');
    const o111 = en3.occurrences.find(o => o.gbif_id === '111');
    const o222 = en3.occurrences.find(o => o.gbif_id === '222');
    assert.ok(o111 && o111.already_imported === true, 'already-imported occurrence flagged (skipped before download)');
    assert.ok(o222 && o222.already_imported === false, 'new occurrence not flagged');
    pass('GBIF dup detection: already-in-library occurrences flagged before any download');

    // --- 18. Non-image downloads (blocked-host HTML) are rejected, no item ----
    const htmlData = 'data:text/html;base64,' +
      Buffer.from('<html><head><title>Request Rejected</title></head><body>no</body></html>').toString('base64');
    let rejected = false;
    try { await gbifService.saveImport(user, gbifProject.id, '999', htmlData); }
    catch (_) { rejected = true; }
    assert.ok(rejected, 'saveImport rejects non-image bytes');
    assert.ok(!itemService.list(user, gbifProject.id, {}).some(it => it.filename === 'GBIF_999.jpg'),
      'no broken Library item created from an HTML rejection page');
    assert.ok(!gbifService.list(user, gbifProject.id).some(r => r.gbif_id === '999'),
      'no GBIF reference row created for the rejected download');
    pass('GBIF import rejects non-image downloads (blocked-host HTML) — no broken item');

    // --- 19. Deleting a GBIF-imported image cascades to its reference row -----
    const item111 = itemService.list(user, gbifProject.id, {}).find(it => it.filename === 'GBIF_111.jpg');
    assert.ok(item111, 'GBIF_111 image present before delete');
    sourceService.remove(user, item111.source_id);
    assert.ok(!gbifService.list(user, gbifProject.id).some(r => r.gbif_id === '111'),
      'GBIF reference row removed when its Library image is deleted (no orphan)');
    pass('deleting a GBIF-imported image cascades to its reference row');
  } finally {
    global.fetch = realFetch;
  }

  dbConn.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\nALL PIPELINE CHECKS PASSED');
})().catch(err => { console.error('\nSMOKE FAILED:', err && err.stack || err); process.exit(1); });

async function assertThrows(fn, msg) {
  let threw = false;
  try { await fn(); } catch (_) { threw = true; }
  assert.ok(threw, `expected throw: ${msg}`);
}

// Build a minimal valid 2-page PDF (correct xref offsets) for the PDF test.
function makeTestPdf() {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R /Resources << /Font << /F1 6 0 R >> >> >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 7 0 R /Resources << /Font << /F1 6 0 R >> >> >>',
  ];
  const s1 = 'BT /F1 24 Tf 40 100 Td (Page One) Tj ET';
  objs.push(`<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const s2 = 'BT /F1 24 Tf 40 100 Td (Page Two) Tj ET';
  objs.push(`<< /Length ${s2.length} >>\nstream\n${s2}\nendstream`);
  let out = Buffer.from('%PDF-1.4\n', 'latin1');
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out = Buffer.concat([out, Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1')]); });
  const xrefPos = out.length;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offs.forEach(off => { xref += String(off).padStart(10, '0') + ' 00000 n \n'; });
  return Buffer.concat([out, Buffer.from(xref, 'latin1'),
    Buffer.from(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`, 'latin1')]);
}

function waitFor(cond, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      let ok = false;
      try { ok = cond(); } catch (_) {}
      if (ok) { clearInterval(iv); resolve(); }
      else if (Date.now() - start > timeoutMs) { clearInterval(iv); reject(new Error('waitFor timed out')); }
    }, 25);
  });
}
