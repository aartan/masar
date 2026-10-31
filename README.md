# Masar

Masar is a local-first Kanban workspace for organising projects, managing tasks
and tracking progress. It runs as a desktop application on macOS, Windows and
Linux with an embedded SQLite database, and works fully offline.

![Masar dashboard](docs/screenshots/dashboard.png)

## Get Masar

Download the build for your platform from GitHub
[Releases](https://github.com/aartan/masar/releases).

- macOS (Apple Silicon / Intel)
- Windows (x64)
- Linux (rpm / AppImage, x64 / arm64)

## Features

- Boards, customisable columns and drag-and-drop ordering.
- Tasks, descriptions, priorities, due dates, labels, subtasks and comments.
- Board and list views with search, filtering and sorting.
- Dashboard with open work, deadlines, recent activity and progress.
- Light, dark and system themes.
- Fully offline local workspace backed by SQLite.
- Optional Premium Sync for accounts, remote backup and cross-device changes.

## Architecture

Masar is split into two independently deployable projects:

```text
masar/                         masar-sync-api/
Electron + React SPA           Node.js + TypeScript
        |                              |
        |-- local SQLite -----------+  |
        |                           |  |
        +------ HTTPS/Bearer -------->  PostgreSQL
                                       Stripe
```

- **Desktop (`masar`)**: React SPA built with Vite, running inside Electron.
  The renderer talks to a loopback-only local API inside Electron, which reuses
  the existing Drizzle/SQLite data layer. No network connection is required.
- **Premium Sync API (`masar-sync-api`, separate repository)**: authentication,
  Stripe subscriptions, entitlement checks, remote synchronisation storage and
  conflict records. Its PostgreSQL tables live in a dedicated schema and do not
  replace or migrate the desktop SQLite database.
- The former hosted Next.js application has been retired. Premium features are
  implemented only in the API.

## Development

Requirements: Node.js 22+, npm, and optional PostgreSQL for the API.

```bash
npm install
npm run dev            # local API + Vite browser preview
npm run desktop:dev    # compile Electron and open the desktop app
```

Useful checks:

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e       # builds the SPA and runs Playwright
npm run db:migrate
```

The development API listens on `127.0.0.1:4782`; Vite proxies `/api` to it.
The Electron development launcher starts both and loads Vite in the window.

### Local database

SQLite is the desktop's primary datastore:

```text
DATABASE_URL="file:./data/app.db"       # development/CLI
<userData>/masar.db                     # Electron runtime
```

Migrations live in `drizzle/`. They are applied before the Electron local API
starts. Existing databases are upgraded in place; local data is not removed.

On first launch, older unowned/legacy boards are claimed by the single local
workspace. `npm run db:claim-local` can be used for diagnostics.

## Premium sync

Premium sync is optional and requires an account and subscription managed by the
API. The desktop remains free and fully functional without it.

1. Configure/run `masar-sync-api` (see its README).
2. Open **Premium sync** in Masar.
3. Set the API address (defaults to `http://127.0.0.1:8787`; use HTTPS for a
   remote server), create an account or sign in, and subscribe.
4. Masar pushes local changes and pulls remote changes automatically, or on
   demand with **Sync now**.

The API bearer token is held in Electron's main process and encrypted with the
OS keychain (Keychain, DPAPI or libsecret). It is never exposed to the renderer.
If a Linux installation has no keyring, secure token storage is unavailable;
install GNOME Keyring/KWallet or explicitly opt into
`MASAR_ALLOW_PLAINTEXT_TOKEN=1` (development/testing only).

### Synchronisation behaviour

- SQLite remains the source of truth while offline.
- SQLite triggers record local inserts, updates and deletes in an outbox.
- Push requests are idempotent and retried safely after interrupted connections.
- The API assigns each accepted entity change a monotonic revision; clients pull
  everything after their cursor.
- Conflicts are resolved per entity with last-write-wins timestamps. The server
  wins exact ties and records rejected changes for diagnostics.
- A pull never overwrites a newer unsynced local edit; that edit is queued and
  pushed again.
- Deletions are tombstones, so they propagate to other devices.

## Desktop builds

```bash
npm run desktop:build:mac
npm run desktop:build:win
npm run desktop:build:linux
```

The build bundles the SPA, local API, migrator and per-platform libSQL native
packages into the Electron resources directory. Signing/notarization settings
remain in `electron-builder.yml` and `desktop/scripts/`.

## Deployment and migration

The desktop connects to whatever API address is configured in Settings. Moving
the API from local infrastructure to a cloud host only requires:

- deploying `masar-sync-api` with the same environment configuration,
- pointing `PUBLIC_BASE_URL` at the new HTTPS origin,
- changing the API address in Masar (sign-in is required again),
- configuring Stripe webhooks against the new origin.

No desktop rebuild is required for a server move.

Existing hosted web accounts and Turso data are not migrated automatically.
The new API has its own account and subscription records; local SQLite data is
uploaded through normal sync when a user connects the API for the first time.

## Technology

Vite, React, React Router, Tailwind CSS, Electron, Hono, Drizzle ORM, SQLite
(libSQL), dnd-kit, Zod, Vitest, Playwright. The Premium Sync API uses Node.js,
TypeScript, Hono, Knex, PostgreSQL and Stripe.
