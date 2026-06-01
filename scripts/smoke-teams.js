// Targeted smoke test for the teams + multi-user seed + dropdown member picker.
// Run with: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/smoke-teams.js

const dbConn = require('../src/server/db/connection');
const { runMigrations } = require('../src/server/db/migrate');
const { runSeed } = require('../src/server/db/seed');
const authService = require('../src/server/services/auth-service');
const teamService = require('../src/server/services/team-service');
const projectService = require('../src/server/services/project-service');
const userService = require('../src/server/services/user-service');
const adminService = require('../src/server/services/admin-service');

(async () => {
  dbConn.init(':memory:');
  const m = runMigrations();
  console.log('migrations applied:', m.applied.length, '(expect 7)');
  if (!m.applied.includes('007_teams.sql')) {
    console.error('FAIL: 007_teams.sql not in migrations'); process.exit(1);
  }

  const seed = runSeed();
  console.log('seed:', seed);

  // ----- log in as each role and verify -----
  for (const email of ['admin@gmail.com', 'owner@gmail.com', 'editor@gmail.com', 'uploader@gmail.com']) {
    const { user } = await authService.login({ email, password: '1234' });
    console.log(`login ${email}: role=${user.role}`);
  }

  const { token: adminTok } = await authService.login({ email: 'admin@gmail.com', password: '1234' });
  const { token: ownerTok } = await authService.login({ email: 'owner@gmail.com', password: '1234' });
  const admin = authService.userFromToken(adminTok);
  const owner = authService.userFromToken(ownerTok);

  console.log('--- admin sees all teams ---');
  console.log('teams:', teamService.list(admin).map(t => `${t.name} (${t.member_count})`));

  console.log('--- owner.listMyTeammates excludes self ---');
  const teammates = teamService.listMyTeammates(owner);
  const emails = teammates.map(u => u.email);
  console.log('teammates seen by owner@:', emails);
  if (emails.includes('owner@gmail.com')) {
    console.error('FAIL: owner sees themselves'); process.exit(1);
  }
  if (!emails.includes('admin@gmail.com') ||
      !emails.includes('editor@gmail.com') ||
      !emails.includes('uploader@gmail.com')) {
    console.error('FAIL: owner does not see all teammates'); process.exit(1);
  }

  console.log('--- editor (non-admin) cannot list all teams ---');
  const { token: editorTok } = await authService.login({ email: 'editor@gmail.com', password: '1234' });
  const editor = authService.userFromToken(editorTok);
  try {
    teamService.list(editor);
    console.error('FAIL: editor listed teams'); process.exit(1);
  } catch (e) {
    console.log('rejected (expected):', e.code);
  }

  console.log('--- add a member via user_id (new dropdown path) ---');
  // Need a 5th user that is NOT yet on the project.
  const carol = await userService.create(admin, {
    email: 'carol@nybg.org',
    password: 'carolpass',
    display_name: 'Carol Curator',
    team_id: teammates[0].id ? admin.team_id : null, // doesn't matter for this test
  });
  const projects = projectService.list(owner);
  const project = projects[0];
  let members = projectService.addMember(owner, project.id, { user_id: carol.id, role: 'editor' });
  console.log('after add by user_id:', members.map(x => `${x.email}=${x.role}`));
  if (!members.find(x => x.email === 'carol@nybg.org')) {
    console.error('FAIL: carol not added via user_id'); process.exit(1);
  }

  console.log('--- add by email still works (legacy path) ---');
  const dave = await userService.create(admin, {
    email: 'dave@nybg.org', password: 'davepass', display_name: 'Dave Drafter',
  });
  members = projectService.addMember(owner, project.id, { email: 'dave@nybg.org', role: 'uploader' });
  if (!members.find(x => x.email === 'dave@nybg.org')) {
    console.error('FAIL: dave not added via email'); process.exit(1);
  }
  console.log('after add by email:', members.map(x => `${x.email}=${x.role}`));

  console.log('--- admin stats ---');
  console.log(adminService.stats(admin));

  console.log('--- admin can move a user between teams ---');
  // create a second team
  const team2 = teamService.create(admin, { name: 'NYBG Field Crew' });
  await userService.update(admin, dave.id, { team_id: team2.id });
  // owner@ should NOT see dave anymore (different team)
  const newTeammates = teamService.listMyTeammates(owner);
  if (newTeammates.find(u => u.email === 'dave@nybg.org')) {
    console.error('FAIL: owner still sees dave after team move'); process.exit(1);
  }
  console.log('owner@ no longer sees dave@ (moved to other team) ✓');

  console.log('--- non-admin teams.list still rejected ---');
  try {
    teamService.list(editor);
    console.error('FAIL'); process.exit(1);
  } catch (e) {
    console.log('rejected:', e.code, '✓');
  }

  console.log('--- admin.projects overview ---');
  const overview = adminService.projectsOverview(admin);
  console.log('projects overview:', overview.map(p =>
    `${p.name} owner=${p.owner_email} members=${p.member_count} sources=${p.source_count}`
  ));

  console.log('OK');
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
