# IRIS

**IUCN Red List Information System** — a project of The New York Botanical
Garden. Cross-platform desktop prototype, intended to graduate to a public
web service.

## Architecture

```
src/server/      framework-agnostic. NO `electron` imports. Ports unchanged
                 into a future Express server.
src/main/        Electron host. Wires src/server services to IPC handlers
                 that mirror future REST routes one-for-one.
src/renderer/    Browser code. Talks to a single api-client that today
                 wraps IPC; the same surface will wrap fetch() later.
src/shared/      Constants, roles, capability matrix. Loaded by both
                 renderer and main.
```

## Quick start

```sh
npm install      # also runs `electron-builder install-app-deps` postinstall
npm start        # boots the app
```

On first launch the app creates `<userData>/iris.sqlite`, runs the SQL
migrations under `src/server/db/migrations/`, and seeds a Phase 0 dev team
with four users (all password `1234`, bcrypt-hashed at seed time):

- `admin@gmail.com` — global admin (sees Admin Tools)
- `owner@gmail.com` — owns the seeded project
- `editor@gmail.com` — editor on the seeded project
- `uploader@gmail.com` — uploader on the seeded project

The password is bcrypt-hashed at seed time, so the auth flow is the same
shape it will be in production.

## Builds

```sh
npm run pack                       # unpackaged dir build
npm run dist                       # current platform full build
./deploy.sh                        # parallel mac/win/linux + notarize + release
./deploy.sh --skip-release         # build + notarize, no GitHub upload
./deploy.sh --skip-builds          # release pre-built artifacts only
```

Code signing & notarization secrets live in `.env.signing` (gitignored).
Auto-update publishes to `nybgvh/IRIS-Electron` releases.

## Database

SQLite via `better-sqlite3`. Migrations are raw `.sql` files in
`src/server/db/migrations/` — each one is heavily commented so the schema
doubles as documentation. To add a column or a table:

1. Create the next-numbered file (e.g. `007_settings.sql`).
2. Restart the app — `runMigrations()` picks it up automatically.
3. Add the matching repo method in `src/server/repositories/`.

Never edit an applied migration; write a follow-up that ALTERs the prior
state.

## Roles

Two layers:

- **Global** (`users.role`) — `admin` (super-user) or `member`.
- **Per-project** (`project_members.role`) — `owner`, `editor`, or `uploader`.

The capability matrix is in `src/shared/capabilities.js`.
