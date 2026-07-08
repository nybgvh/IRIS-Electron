// Targeted smoke test for project member management.
// Run with: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/smoke-members.js

const dbConn = require('../src/server/db/connection');
const { runMigrations } = require('../src/server/db/migrate');
const { runSeed } = require('../src/server/db/seed');
const authService = require('../src/server/services/auth-service');
const projectService = require('../src/server/services/project-service');
const userService = require('../src/server/services/user-service');

(async () => {
  dbConn.init(':memory:');
  runMigrations();
  runSeed();

  // Admin logs in. There's a seeded project; we use that as the test target.
  const { token: adminToken } = await authService.login({ email: 'admin@gmail.com', password: '1234' });
  const admin = authService.userFromToken(adminToken);
  const projects = projectService.list(admin);
  const project = projects[0];
  console.log('project:', project.name, 'owner_id:', project.owner_id);

  console.log('--- create a second user (admin only) ---');
  const bob = await userService.create(admin, {
    email: 'bob@nybg.org',
    password: 'bobpass',
    display_name: 'Bob Editor',
  });
  console.log('created user:', bob.email, 'id:', bob.id);

  console.log('--- add bob as editor ---');
  let members = projectService.addMember(admin, project.id, { email: 'bob@nybg.org', role: 'editor' });
  console.log('members:', members.map(m => `${m.email}=${m.role}`));

  console.log('--- promote bob to owner ---');
  members = projectService.updateMemberRole(admin, project.id, bob.id, 'owner');
  console.log('after promote:', members.map(m => `${m.email}=${m.role}`));

  console.log('--- try to demote the creator-owner (should FAIL) ---');
  try {
    projectService.updateMemberRole(admin, project.id, project.owner_id, 'editor');
    console.error('UNEXPECTED: demote succeeded');
    process.exit(1);
  } catch (e) {
    console.log('rejected (expected):', e.code, '-', e.message);
  }

  console.log('--- try to remove the creator-owner (should FAIL) ---');
  try {
    projectService.removeMember(admin, project.id, project.owner_id);
    console.error('UNEXPECTED: remove succeeded');
    process.exit(1);
  } catch (e) {
    console.log('rejected (expected):', e.code, '-', e.message);
  }

  console.log('--- bob (now owner) can manage members ---');
  const { token: bobToken } = await authService.login({ email: 'bob@nybg.org', password: 'bobpass' });
  const bobUser = authService.userFromToken(bobToken);
  // Bob creates a third user, then adds them
  const carol = await userService.create(admin, {
    email: 'carol@nybg.org',
    password: 'carolpass',
    display_name: 'Carol Uploader',
  });
  members = projectService.addMember(bobUser, project.id, { email: 'carol@nybg.org', role: 'uploader' });
  console.log('after bob adds carol:', members.map(m => `${m.email}=${m.role}`));

  console.log('--- demote bob and try to manage (should FAIL: no caps) ---');
  projectService.updateMemberRole(admin, project.id, bob.id, 'editor');
  try {
    projectService.addMember(bobUser, project.id, { email: 'carol@nybg.org', role: 'editor' });
    console.error('UNEXPECTED: editor managed members');
    process.exit(1);
  } catch (e) {
    console.log('rejected (expected):', e.code, '-', e.message);
  }

  console.log('--- remove carol cleanly ---');
  members = projectService.removeMember(admin, project.id, carol.id);
  console.log('after remove:', members.map(m => `${m.email}=${m.role}`));

  console.log('OK');
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
