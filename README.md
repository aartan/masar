# Masar

Masar is a Kanban app for organizing projects. It has boards with ordered columns, tasks with labels, subtasks, comments, priorities, and due dates, plus a dashboard for upcoming work and progress.

Every account has a private workspace. Accounts can sign up, sign in, sign out, and keep a persistent session. Boards, tasks, labels, subtasks, comments, search, and dashboard data are scoped to the signed-in account. There is no team sharing or cross-account access.

Built with Next.js, React, Tailwind CSS, Drizzle, SQLite/libSQL, Better Auth, dnd-kit, Zod, Vitest, and Playwright. 
[Try Masar online](https://next-kanban-gamma.vercel.app/). Create an account and select **Start with demo content** to explore a populated workspace.

![Masar dashboard](docs/screenshots/dashboard.png)

## Features

- Private workspaces: every board and all of its child data belong to one account. Guessing another account's board, task, label, subtask, or comment ID returns a 404.
- Empty by default: a new account starts with no boards. Demo content is added only when the sign-up checkbox is selected.
- Boards and columns: create, rename, recolor, reorder, and delete them. Each board has one done column. Deleting a column moves its tasks to the first remaining column.
- Tasks: create inline or in a dialog, then edit the title, description, priority, due date, labels, subtasks, and comments. Duplicate or delete tasks when needed.
- Drag and drop: move tasks within or between columns with a pointer or keyboard. The order is saved. Reordering is disabled while filters or non-manual sorting are active.
- Views: switch between board and list views. The choice is saved in the browser.
- Search and filters: search the current board, filter by priority, label, due date, or status, and sort manually, by due date, priority, or newest. Cmd/Ctrl+K opens global search.
- Dashboard: open tasks, due this week, completed in the last seven days, active boards, upcoming work, priority breakdown, recent tasks, and board progress.
- Themes and layout: light, dark, and system themes, a responsive sidebar, mobile navigation, toasts, and confirmation dialogs.
- Data: SQLite locally, Turso when deployed, with migrations, foreign keys, indexes, and transactions.
- Accounts: email/password sign-up and sign-in, persistent sessions, and sign-out from the sidebar.
- Optional premium cloud sync: Unlock premium to enable online syncing across supported devices and systems, including Windows, macOS, and the web app. Keep your work synchronized between systems while retaining local access to your data.
- Cross-platform desktop apps: Use dedicated Electron desktop applications for Windows and macOS, alongside the web app. Work offline by default and unlock premium to synchronize data between devices.


## Running locally

You need Node.js 20.9 or newer and npm.

```bash
npm install
cp .env.example .env.local
# Add BETTER_AUTH_SECRET to .env.local:
#   openssl rand -base64 32
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and create an account at `/signup`.

The app uses `./data/app.db` by default. `npm run dev` applies pending migrations before starting. A new account starts empty; select **Start with demo content** during sign-up to add the sample board.

To seed demo boards into an existing account, register that account first and run:

```bash
npm run db:seed -- --email you@example.com
```

`db:seed` skips an account that already has boards. Add `--force` to replace that account's boards with demo content. It never touches another account's data. To delete the local database and start over, run `npm run db:reset`.

### Environment variables

Local development needs a `BETTER_AUTH_SECRET` for stable sessions. Everything else has a local default.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | `file:./data/app.db` locally or a hosted `libsql://…` URL. Required on Vercel. |
| `TURSO_DATABASE_URL` | Alias for `DATABASE_URL`. |
| `TURSO_AUTH_TOKEN` | Auth token for a hosted Turso database. |
| `DATABASE_AUTH_TOKEN` | Alias for `TURSO_AUTH_TOKEN`. |
| `BETTER_AUTH_SECRET` | Signs session cookies. Generate with `openssl rand -base64 32`. Required in production. |
| `BETTER_AUTH_URL` | Public origin used by authentication, for example `https://masar.example.com`. |
| `ALLOW_LOCAL_DB_IN_PRODUCTION` | Suppresses the local-file warning in a non-Vercel production runtime. Don't set it on Vercel. |

Copy `.env.example` to `.env.local` if you need overrides. `.env.local` takes precedence over `.env`.

`src/db/config.ts` picks the database. On Vercel, the app needs `DATABASE_URL` and an auth token. If they are missing or point to a local file, it fails with a configuration error instead of writing to temporary storage. The production runtime throws if `BETTER_AUTH_SECRET` is missing; `next build` itself does not require it.

### Database commands

| Command | What it does |
| --- | --- |
| `npm run db:migrate` | Apply pending migrations. |
| `npm run db:seed -- --email you@example.com` | Add demo boards to that existing account if it has no boards. |
| `npm run db:seed -- --email you@example.com --force` | Replace that account's boards with demo content. |
| `npm run db:claim-workspace -- --email owner@example.com --dry-run` | Count pre-auth and unowned boards that would be assigned to that account. |
| `npm run db:claim-workspace -- --email owner@example.com --confirm` | Assign those boards to that account. |
| `npm run db:reset` | Delete the local database and re-run migrations. Never run against production. |
| `npm run db:generate` | Generate a migration after schema changes. |
| `npm run db:studio` | Open Drizzle Studio. |

## Migrating an existing single-user database

Migration `drizzle/0001_auth_and_workspace_ownership.sql` adds the auth tables, a nullable `boards.owner_id` foreign key, and an owner/position index. It also:

1. Creates a system account with the id `legacy-workspace` and email `legacy-workspace@masar.invalid`. It has no password, account, or session, so nobody can sign in as it.
2. Assigns every existing board to that system account.
3. Leaves `owner_id` nullable so the old single-user app keeps working if it writes during the migration-first rollout.

New application code never reads boards whose `owner_id` is `NULL` or `legacy-workspace`. Those rows are therefore invisible to every registrant until an operator explicitly claims them. A board inserted by the old app after the migration also receives `NULL` and is handled the same way.

The claim command is deliberately explicit and requires a confirmation flag:

```bash
npm run db:claim-workspace -- --email owner@example.com --dry-run
npm run db:claim-workspace -- --email owner@example.com --confirm
```

The account must already exist. `--dry-run` only counts boards; `--confirm` moves all `legacy-workspace` and `NULL`-owned boards to that account and removes the system account. It does not touch boards owned by other accounts, and it does not change task, label, subtask, or comment content. If you never claim the old data, it stays orphaned and inaccessible to registrants.

> **Warning:** The claim is the only step that decides who receives the old single-user data. Do not run `--confirm` until the intended owner has registered. Never hand the legacy workspace to the first person who happens to sign up.

## Deploying

Masar needs a hosted Turso/libSQL database when it is deployed. These steps use Vercel, but the same environment variables work on other Node hosts.

1. Create a Turso database and token:

   ```bash
   turso db create masar
   turso db show masar --url
   turso db tokens create masar
   ```

2. Generate an auth secret:

   ```bash
   openssl rand -base64 32
   ```

3. Add the environment variables to the Production (and Preview) environment in your host:

   - `DATABASE_URL` — the `libsql://…` URL
   - `TURSO_AUTH_TOKEN` — the database token
   - `BETTER_AUTH_SECRET` — the generated secret
   - `BETTER_AUTH_URL` — the public URL of the app

4. Back up the production database before changing anything.

5. **Run the migration while the old app is still deployed.** This is safe because the new owner column is nullable and existing rows are preserved:

   ```bash
   DATABASE_URL="libsql://masar-<org>.turso.io" \
   TURSO_AUTH_TOKEN="<token>" \
   npm run db:migrate
   ```

   The old app remains usable immediately after this step. It does not know about the new column, so any board it creates during the rollout stays unowned.

6. Deploy the new application code. Do not reverse steps 5 and 6: the new code expects the auth tables and `owner_id` to exist.

7. Register the account that should own the pre-auth workspace, for example `owner@example.com`. Other accounts can register too; the claim only targets the email you pass explicitly.

8. Claim the old workspace against that account:

   ```bash
   DATABASE_URL="libsql://masar-<org>.turso.io" \
   TURSO_AUTH_TOKEN="<token>" \
   npm run db:claim-workspace -- --email owner@example.com --dry-run
   ```

   If the count looks right, repeat with `--confirm`:

   ```bash
   DATABASE_URL="libsql://masar-<org>.turso.io" \
   TURSO_AUTH_TOKEN="<token>" \
   npm run db:claim-workspace -- --email owner@example.com --confirm
   ```

9. Check `/api/health`, sign in as the intended owner, and verify boards, tasks, labels, subtasks, and comments survived the migration.

Migrations do not run during `next build`. Apply them as a separate deploy or CI step, in the order above. `npm run db:reset` and destructive seeds are local-only tools; never run them against production.

## Tests

```bash
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run verify
```

Vitest uses a temporary SQLite database, so tests don't touch `data/app.db`. The suite covers the migration from the old schema, preservation and claiming of legacy rows, owner-scoped server operations, and cross-account isolation. Playwright uses `data/e2e.db`, starts the dev server on port 3100 with a test auth secret, and covers sign-up, sign-in, sign-out, empty workspaces, demo opt-in, account isolation, and the main board workflows. `npm run verify` runs lint, typecheck, tests, and a build.

## Desktop app (macOS and Windows)

Masar ships as a native desktop application built with Electron, reusing the
exact web UI and server code. In local mode it runs the Next.js server on a
private loopback port and loads it in the window; in sync mode it loads your
hosted deployment instead. Either way it is a native window with native menus
and lifecycle, not browser chrome.

The desktop app runs in one of two workspace modes, selected from the
**Workspace** menu:

- **Local (free, default):** a single-user offline workspace with no sign-up or
  sign-in. Data is stored privately in a local SQLite database in the OS
  user-data directory (`~/Library/Application Support/Masar/masar.db` on macOS,
  `%APPDATA%\\Masar\\masar.db` on Windows). One implicit local account owns
  everything.
- **Sync (premium):** the app loads your centrally-hosted Masar deployment and
  the user signs in with a real account, so boards, tasks, and labels sync across
  devices and with the hosted web app. No database credentials ship in the app.

The session-signing secret is generated on first run and stored encrypted with
the OS keystore (Keychain on macOS, DPAPI on Windows). Logs are written to
`~/Library/Logs/Masar/masar.log` (macOS) or the equivalent app-logs directory.

### Architecture

Desktop-specific code lives in [`desktop/`](desktop/) and is the only code that
is platform-aware; the application in `src/` is unchanged except for enabling
`output: "standalone"` in `next.config.ts`. Platform differences (paths, process
lifecycle, menus, secret storage) are isolated behind small modules so the same
codebase targets both macOS and Windows.

On launch the Electron main process reads the saved workspace mode. In local
mode it loads or generates the auth secret, runs database migrations against the
local file, picks a free loopback port, starts the Next.js standalone server,
waits for `/api/health`, and opens the window; any failure (secure storage,
migration, server) shows an error dialog and exits rather than falling back to
an ephemeral database. In sync mode it starts no local server — it opens the
window directly on your hosted deployment URL. Switching modes persists the
choice and relaunches.

### Workspace modes and premium sync

New installs start in **local mode**: the app opens straight to the workspace
with no account. Sync is controlled from the **Settings** menu in the sidebar
footer (the avatar button bottom-left), which also holds appearance and keyboard
shortcuts; the same actions are mirrored in the native **Workspace** menu. To
enable sync a user first unlocks premium. In this build, "Unlock Sync (Premium)"
is a placeholder for a real purchase or license check — the seam is isolated in
the Electron main process (`desktop/src/main.ts` / `desktop/src/settings.ts`),
reached from the renderer through a small IPC bridge
(`desktop/src/preload.ts`), so a payment flow can be wired in later without
touching the app.

Sync is managed centrally by you, not configured by users. In sync mode the
desktop window loads your **hosted Masar deployment** and the user signs in
there, so no database credentials ever ship inside the app — all data access is
server-side on your infrastructure. Set your hosted origin in
[`desktop/src/sync-config.ts`](desktop/src/sync-config.ts) (the `DEFAULT_SYNC_URL`
constant), or override it with the `MASAR_SYNC_URL` environment variable:

| Setting | Purpose |
| --- | --- |
| `DEFAULT_SYNC_URL` (in `sync-config.ts`) | Your deployed Masar origin, e.g. `https://masar.example.com`. |
| `MASAR_SYNC_URL` (env) | Overrides the above at build or launch time. |

Local mode still runs the native local server; only sync mode points at the
host. The split is clean: offline work stays in the local workspace, and the
online tier is your hosted app in a native window. Because sync loads your live
deployment, server and online-UI changes reach every desktop on your next
deploy, with no app rebuild.

When a user enables sync, the Workspace menu offers **Import Local Data Into
Account**. The app reads its local workspace and uploads it to your hosted app's
`/api/desktop/import-local` endpoint, which creates the boards, tasks, labels,
subtasks, and comments under the signed-in account (idempotent; ids are
preserved). The local workspace is left untouched, so switching back to local
mode restores it. This requires your deployment to include this route, so deploy
the current app before relying on import.

### Prerequisites

Both platforms need Node.js 20.9+ and npm, plus the project dependencies
(`npm install`). No Rust toolchain is required (unlike Tauri). The native
SQLite driver ships as prebuilt binaries, so there is no native compilation
step. The build fetches the per-architecture libSQL binaries automatically and
caches them under `desktop/vendor/`.

- **macOS**: build on macOS. Xcode Command Line Tools are needed only if you add
  code signing. Unsigned/ad-hoc builds run locally; see signing below.
- **Windows**: build on Windows (or a Windows CI runner such as GitHub Actions
  `windows-latest`). The configuration is in place, but Windows packaging is
  **not** verified by building on macOS and must be built and smoke-tested on
  Windows. Windows on ARM is out of scope: libSQL publishes no `win32-arm64`
  prebuilt binary.

### Building

```bash
# macOS: produces dist-desktop/Masar-<version>-arm64.dmg and -x64.dmg
npm run desktop:build:mac

# Windows (run on a Windows host/CI): produces an NSIS .exe installer
npm run desktop:build:win
```

Development loop (loads a live `next dev` server in the Electron shell):

```bash
npm run desktop:dev
```

### Code signing and notarization (macOS)

The macOS build is unsigned (ad-hoc) by default, which runs on the build machine
but is Gatekeeper-quarantined elsewhere. Signing and notarization are wired in
and inert until credentials are supplied. To produce a distributable build, set
a Developer ID identity (replace `identity: null` in
[`electron-builder.yml`](electron-builder.yml), or provide `CSC_LINK` /
`CSC_KEY_PASSWORD`) and export `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and
`APPLE_TEAM_ID` so the notarization hook ([`desktop/scripts/notarize.js`](desktop/scripts/notarize.js))
runs. Hardened runtime and the required entitlements are already configured.

## License

Private project. All rights reserved.
