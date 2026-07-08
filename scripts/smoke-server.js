// Smoke test for the framework-agnostic server layer.
// Run with: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/smoke-server.js
// (Electron's bundled Node has the correct ABI for the native better-sqlite3.)

const os = require('os');
const path = require('path');
const fs = require('fs');

const dbConn = require('../src/server/db/connection');
const { runMigrations } = require('../src/server/db/migrate');
const { runSeed } = require('../src/server/db/seed');
const authService = require('../src/server/services/auth-service');
const projectService = require('../src/server/services/project-service');
const sourceService = require('../src/server/services/source-service');
const fileStore = require('../src/server/storage/file-store');

(async () => {
  // Use a temp storage root so smoke-test artifacts don't pollute userData.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-smoke-'));
  fileStore.init(tmp);
  console.log('storage root:', tmp);

  dbConn.init(':memory:');
  console.log('migrations:', runMigrations());
  console.log('seed:', runSeed());

  console.log('--- good login ---');
  const ok = await authService.login({ email: 'admin@gmail.com', password: '1234' });
  console.log('user:', ok.user.email, 'role:', ok.user.role);
  const user = authService.userFromToken(ok.token);

  console.log('--- projects.list (seeded default expected) ---');
  const projects = projectService.list(user);
  console.log('projects:', projects.map(p => `${p.id}:${p.name}`));
  if (!projects.length) { console.error('FAIL: no projects seeded'); process.exit(1); }
  const projectId = projects[0].id;

  console.log('--- source upload (small fake image) ---');
  const fakeBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );
  const src = await sourceService.upload(user, projectId, {
    filename: 'pixel.png',
    mime_type: 'image/png',
    buffer: fakeBytes,
    source_type: 'image',
  });
  console.log('source row:', { id: src.id, filename: src.filename, sha: src.sha256.slice(0, 12), bytes: src.byte_size });
  console.log('metadata has stub keys:', Object.keys(src.metadata));

  console.log('--- sources.list ---');
  const listed = sourceService.list(user, projectId);
  console.log('count:', listed.length, 'metadata[0] type:', typeof listed[0].metadata);

  console.log('OK');
})().catch(e => {
  console.error('FAIL:', e);
  process.exit(1);
});
