/*
 * Remove broken GBIF Library items — occurrences whose "image" is actually an
 * HTML rejection page (a bot-blocking host returned HTML instead of the image,
 * and an earlier build stored it as a .jpg). Deletes the stored file, the
 * VoucherVision record(s) + on-disk artifacts, the GBIF reference row, and the
 * source row — so the item disappears from the Library AND can be re-imported
 * (the gbif_id dedup no longer blocks it).
 *
 * DRY RUN by default — lists what it would delete. Pass --apply to delete.
 * Optional first arg: the app data root (default: macOS userData for "iris").
 *
 * Run under Electron's runtime (native sharp / better-sqlite3):
 *   env -u ELECTRON_RUN_AS_NODE ELECTRON_RUN_AS_NODE=1 \
 *     ./node_modules/.bin/electron scripts/cleanup-broken-gbif.js [root] [--apply]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const rootArg = args.find(a => !a.startsWith('--'));
const ROOT = rootArg || path.join(os.homedir(), 'Library', 'Application Support', 'iris');

const dbConn = require('../src/server/db/connection');
const fileStore = require('../src/server/storage/file-store');
const sourceRepo = require('../src/server/repositories/source-repo');
const vvRepo = require('../src/server/repositories/vouchervision-repo');

async function isImageFile(absPath) {
  try {
    const buf = fs.readFileSync(absPath);
    const meta = await sharp(buf).metadata();
    return !!(meta && meta.format && meta.width && meta.height);
  } catch (_) {
    return false;
  }
}

(async () => {
  const dbPath = path.join(ROOT, 'iris.sqlite');
  const storeRoot = path.join(ROOT, 'storage');
  if (!fs.existsSync(dbPath)) { console.error('DB not found at', dbPath); process.exit(1); }
  console.log(`root:  ${ROOT}`);
  console.log(`mode:  ${APPLY ? 'APPLY (deleting)' : 'DRY RUN (no changes)'}\n`);

  dbConn.init(dbPath);
  fileStore.init(storeRoot);
  const db = dbConn.getDb();

  const rows = db.prepare("SELECT id, project_id, filename, storage_path FROM sources WHERE filename LIKE 'GBIF_%'").all();
  const broken = [];
  for (const r of rows) {
    const abs = path.join(storeRoot, r.storage_path);
    if (!(await isImageFile(abs))) broken.push(r);
  }

  console.log(`Broken (non-image) GBIF items: ${broken.length} of ${rows.length}`);
  for (const b of broken) console.log(`  source ${b.id}  ${b.filename}`);

  // Orphaned reference rows: the Library image was deleted but the GBIF citation
  // row survived (FK ON DELETE SET NULL). These clutter References and block
  // re-import (gbif_id dedup), so remove them too.
  const orphans = db.prepare(
    'SELECT id, gbif_id FROM project_sources_gbif WHERE source_id IS NULL OR source_id NOT IN (SELECT id FROM sources)'
  ).all();
  console.log(`Orphaned GBIF reference rows: ${orphans.length}`);

  if (!broken.length && !orphans.length) { console.log('\nNothing to clean up.'); return; }
  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply to delete the above.'); return; }

  const delGbif = db.prepare('DELETE FROM project_sources_gbif WHERE source_id = ?');
  let removed = 0;
  for (const b of broken) {
    try {
      const rec = vvRepo.findBySource(b.id);
      if (rec) { fileStore.deleteVouchervisionArtifacts(rec.project_id, rec.id); vvRepo.remove(rec.id); }
      const src = sourceRepo.findById(b.id);
      if (src) fileStore.deleteFile(src.storage_path);
      delGbif.run(b.id);
      sourceRepo.remove(b.id);
      removed += 1;
    } catch (err) {
      console.error(`  ! failed to remove source ${b.id}:`, err && err.message || err);
    }
  }
  const delOrphan = db.prepare('DELETE FROM project_sources_gbif WHERE id = ?');
  let orphansRemoved = 0;
  for (const o of orphans) { try { delOrphan.run(o.id); orphansRemoved += 1; } catch (_) {} }

  console.log(`\nDeleted ${removed} broken item(s) + ${orphansRemoved} orphaned reference row(s). They can now be re-imported.`);
})().catch(err => { console.error('FATAL', err && err.stack || err); process.exit(1); });
