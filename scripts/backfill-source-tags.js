/*
 * Backfill provenance tags on existing Library items: "GBIF" for imported GBIF
 * occurrences (metadata.imported_from === 'gbif'), "User Upload" for everything
 * else the user provided. Idempotent (get-or-create tag + INSERT OR IGNORE
 * assignment), so it's safe to run more than once.
 *
 * DRY RUN by default. Pass --apply to write. Optional first arg: app data root.
 *   env -u ELECTRON_RUN_AS_NODE ELECTRON_RUN_AS_NODE=1 \
 *     ./node_modules/.bin/electron scripts/backfill-source-tags.js [root] [--apply]
 */

const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const rootArg = args.find(a => !a.startsWith('--'));
const ROOT = rootArg || path.join(os.homedir(), 'Library', 'Application Support', 'iris');

const dbConn = require('../src/server/db/connection');
const tagRepo = require('../src/server/repositories/tag-repo');

// Mirror source-service.sourceTagFor.
const SOURCE_TAGS = { gbif: { name: 'GBIF', color: '#0098c3' } };
function sourceTagFor(meta) {
  const from = meta && meta.imported_from;
  if (from) return SOURCE_TAGS[from] || { name: String(from).toUpperCase(), color: null };
  return { name: 'User Upload', color: '#6d7b32' };
}

dbConn.init(path.join(ROOT, 'iris.sqlite'));
const db = dbConn.getDb();

const rows = db.prepare('SELECT id, project_id, metadata_json FROM sources').all();
const counts = {};
let assigned = 0;

// cache tag by (project, name) so we don't re-create/lookup constantly
const tagCache = new Map();
function getOrCreateTag(projectId, name, color) {
  const key = projectId + '|' + name;
  if (tagCache.has(key)) return tagCache.get(key);
  let t = tagRepo.findByName(projectId, name);
  if (!t && APPLY) t = tagRepo.create({ project_id: projectId, name, color });
  tagCache.set(key, t);
  return t;
}

for (const r of rows) {
  let meta = {};
  try { if (r.metadata_json) meta = JSON.parse(r.metadata_json); } catch (_) {}
  const { name, color } = sourceTagFor(meta);
  counts[name] = (counts[name] || 0) + 1;
  if (APPLY) {
    const tag = getOrCreateTag(r.project_id, name, color);
    if (tag) { tagRepo.assign(r.id, tag.id, null); assigned += 1; }
  }
}

console.log(`root: ${ROOT}`);
console.log(`sources scanned: ${rows.length}`);
console.log('tags to apply:', counts);
console.log(APPLY ? `\nAssigned ${assigned} provenance tag(s).` : '\nDRY RUN — re-run with --apply to write.');
