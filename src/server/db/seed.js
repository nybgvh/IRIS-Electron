/*
 * Idempotent seed for Phase 0.
 *
 * Seeds:
 *   - One team ("NYBG Dev Team")
 *   - Four users on that team, all bcrypt-hashed password "1234":
 *       admin@gmail.com    — global role 'admin'  (sees Admin Tools)
 *       owner@gmail.com    — global role 'member' (owns the seeded project)
 *       editor@gmail.com   — global role 'member' (editor on seeded project)
 *       uploader@gmail.com — global role 'member' (uploader on seeded project)
 *   - One default project owned by owner@gmail.com, with the editor and
 *     uploader added as project_members with their respective roles.
 *
 * Idempotent: re-running skips any user / team / project that already
 * exists by its natural key. Legacy 1234@gmail.com, if present in a stale
 * dev DB, is left alone — devs who want a clean state delete the SQLite
 * file under userData and let migrations + seed rebuild from scratch.
 *
 * Remove this seed (or replace it with a real "first admin" CLI) before
 * shipping to anyone outside the dev team.
 */

const { getDb } = require('./connection');
const { hashSync } = require('../auth/password');
const { GLOBAL_ROLES, PROJECT_ROLES } = require('../../shared/roles');

const SEED_TEAM = {
  name: 'NYBG Dev Team',
  description: 'Default team for the Phase 0 prototype.',
};

const SEED_USERS = [
  { email: 'admin@gmail.com',    password: '1234', display_name: 'Admin User',    role: GLOBAL_ROLES.ADMIN  },
  { email: 'owner@gmail.com',    password: '1234', display_name: 'Project Owner', role: GLOBAL_ROLES.MEMBER },
  { email: 'editor@gmail.com',   password: '1234', display_name: 'Project Editor', role: GLOBAL_ROLES.MEMBER },
  { email: 'uploader@gmail.com', password: '1234', display_name: 'Field Uploader', role: GLOBAL_ROLES.MEMBER },
];

const SEED_PROJECT = {
  name: 'NYBG Red List Assessment Workspace',
  description: 'Default IRIS project — used during Beta development.',
  // Who creates the project — by email so we don't bake an ID in.
  owner_email: 'owner@gmail.com',
  // Other team members added as project_members at create time, by email.
  other_members: [
    { email: 'editor@gmail.com',   role: PROJECT_ROLES.EDITOR   },
    { email: 'uploader@gmail.com', role: PROJECT_ROLES.UPLOADER },
  ],
};

function runSeed() {
  const db = getDb();
  const seeded = { team: false, users: [], project: false };

  // 1. Team -----------------------------------------------------------------
  let team = db.prepare('SELECT * FROM teams WHERE name = ?').get(SEED_TEAM.name);
  if (!team) {
    const info = db.prepare('INSERT INTO teams (name, description) VALUES (?, ?)')
      .run(SEED_TEAM.name, SEED_TEAM.description);
    team = db.prepare('SELECT * FROM teams WHERE id = ?').get(info.lastInsertRowid);
    seeded.team = true;
  }

  // 2. Users (each pinned to the team) --------------------------------------
  const findUser   = db.prepare('SELECT * FROM users WHERE email = ?');
  const insertUser = db.prepare(`
    INSERT INTO users (email, password_hash, display_name, role, team_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const u of SEED_USERS) {
    if (findUser.get(u.email)) continue;
    insertUser.run(u.email, hashSync(u.password), u.display_name, u.role, team.id);
    seeded.users.push(u.email);
  }

  // 3. Project + members ----------------------------------------------------
  const owner = findUser.get(SEED_PROJECT.owner_email);
  if (owner) {
    const existing = db.prepare(`
      SELECT id FROM projects WHERE owner_id = ? AND name = ? AND archived_at IS NULL
    `).get(owner.id, SEED_PROJECT.name);
    if (!existing) {
      const tx = db.transaction(() => {
        const info = db.prepare(`
          INSERT INTO projects (name, description, owner_id) VALUES (?, ?, ?)
        `).run(SEED_PROJECT.name, SEED_PROJECT.description, owner.id);
        const projectId = info.lastInsertRowid;
        const addMember = db.prepare(`
          INSERT INTO project_members (project_id, user_id, role, added_by)
          VALUES (?, ?, ?, ?)
        `);
        // Owner row first.
        addMember.run(projectId, owner.id, PROJECT_ROLES.OWNER, owner.id);
        // Editors and uploaders.
        for (const m of SEED_PROJECT.other_members) {
          const u = findUser.get(m.email);
          if (u) addMember.run(projectId, u.id, m.role, owner.id);
        }
      });
      tx();
      seeded.project = true;
    }
  }

  return seeded;
}

module.exports = { runSeed };
