# Kanso

A calm, keyboard-first Kanban workspace. Kanso pairs a warm paper-and-forest visual system with a fast, durable task workflow: boards, columns, drag-and-drop ordering, subtasks, labels, comments, search, filters, and a live dashboard.

Built with Next.js App Router, TypeScript, Tailwind CSS, Drizzle ORM, libSQL/SQLite, dnd-kit, Zod, Vitest, and Playwright.

## Features

- **Boards & columns** — create, rename, recolor, reorder, and delete boards and columns. Each board has one completion column; deleting a column moves its tasks to the first remaining column.
- **Tasks** — inline and dialog creation, full editing, priorities, due dates, free-text assignees, labels, subtasks, comments, duplication, and confirmed deletion.
- **Drag and drop** — move tasks within and across columns with pointer or keyboard. Ordering persists to the database. Reordering is paused while filters or non-manual sorting are active.
- **Views** — board and list views, persisted per browser.
- **Find & filter** — board search, priority/label/due-date/status filters, manual/due/priority/newest sorting, and a command palette (`⌘K` / `Ctrl K`) for global task and board search.
- **Dashboard** — real workspace metrics, completion rates, upcoming and overdue work, priority distribution, workload by assignee, recent tasks, and per-board progress.
- **Craft details** — responsive sidebar and mobile navigation, light/dark/system themes, toasts, loading and empty states, destructive-action confirmations, accessible focus states, and reduced-motion support.
- **Durable data layer** — normalized schema, migrations, foreign keys with cascading deletes, indexes, transactions, server-only database access, and Zod validation at every write boundary.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Server Components, Route Handlers) |
| UI | React 19, Tailwind CSS 4, custom shadcn-style primitives, Radix UI, Lucide |
| Data | Drizzle ORM, libSQL client, SQLite locally, Turso in production |
| Interaction | dnd-kit, Sonner, next-themes |
| Validation | Zod 4 |
| Tests | Vitest 5, Playwright 1.64 |

## Quick start

Requirements: **Node.js 20.9+** and npm.

```bash
npm install
cp .env.example .env.local   # optional; the local default works without it
npm run db:migrate
npm run db:seed              # load the demo workspace
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The local database is a persistent SQLite file at `./data/app.db`, created on first use. On later runs, `npm run dev` applies pending migrations automatically via `predev`. The seed is idempotent: it skips when boards already exist. To replace local data with the demo workspace:

```bash
npm run db:seed -- --force
```

To start from an empty database:

```bash
npm run db:reset   # deletes the local DB file, re-runs migrations
```

## Environment variables

Local development needs no configuration. The following variables are supported:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | No locally, **yes on Vercel** | `file:./data/app.db` or a hosted `libsql://…` URL. |
| `TURSO_DATABASE_URL` | No | Alias for `DATABASE_URL`. |
| `TURSO_AUTH_TOKEN` | With hosted Turso | Database auth token. |
| `DATABASE_AUTH_TOKEN` | No | Alias for `TURSO_AUTH_TOKEN`. |
| `ALLOW_LOCAL_DB_IN_PRODUCTION` | No | Set to `true` to allow a `file:` database in a non-Vercel production runtime. Never enable on Vercel. |

Copy `.env.example` to `.env.local` when you need overrides. `.env.local` takes precedence over `.env`.

### Production safeguards

`src/db/config.ts` resolves the database for every runtime:

- Vercel with no `DATABASE_URL` fails with a clear configuration error instead of writing to an ephemeral filesystem.
- Vercel with a `file:` URL fails for the same reason.
- Vercel with a remote URL but no auth token fails with a clear error.
- Other production runtimes may use a local file only when `ALLOW_LOCAL_DB_IN_PRODUCTION=true`; otherwise a warning is logged.

The app also exposes `GET /api/health`, which runs `select 1` against the configured database.

## Database workflow

The schema lives in `src/db/schema.ts`; generated SQL migrations live in `drizzle/`.

```bash
npm run db:generate   # generate a migration after schema changes
npm run db:migrate    # apply pending migrations
npm run db:seed       # insert demo data (skips if data exists)
npm run db:seed -- --force  # replace all data with demo data
npm run db:studio     # open Drizzle Studio
npm run db:reset      # local only: delete the file, migrate, then seed manually
```

Migration and seed scripts load `.env.local` and `.env`, so they target the same database as the app. The reset script refuses to run against a remote database.

### Data model

| Table | Notes |
| --- | --- |
| `boards` | Name, description, accent color, position. |
| `columns` | Belongs to a board; ordered; `is_done` marks the completion column; unique name per board. |
| `tasks` | Belongs to a board and column; title, description, priority, due date, assignee, position, completion timestamp. |
| `labels` | Board-scoped, colored, unique name per board. |
| `task_labels` | Many-to-many join table with a composite primary key. |
| `subtasks` | Task-scoped, ordered, completion flag. |
| `comments` | Task-scoped, author (defaults to “You”), body, timestamp. |

All foreign keys cascade on delete. Timestamps are stored as Unix epoch milliseconds for consistent behavior across local SQLite and Turso. Ordering is persisted as integer positions and updated inside transactions by the reorder endpoints.

## Deploying to Vercel

Kanso requires a hosted Turso/libSQL database in production.

1. **Create the database**

   ```bash
   turso db create kanso
   turso db show kanso --url
   turso db tokens create kanso
   ```

2. **Apply migrations to Turso**

   Run this once before the first deployment, and again whenever migrations are added:

   ```bash
   DATABASE_URL="libsql://kanso-<org>.turso.io" \
   TURSO_AUTH_TOKEN="<token>" \
   npm run db:migrate
   ```

   The same command works from CI. Optionally seed demo data with `npm run db:seed` (use `-- --force` only when you intend to replace production data).

3. **Configure Vercel**

   Add `DATABASE_URL` and `TURSO_AUTH_TOKEN` to the project’s Production and Preview environment variables. Deploy the repository normally; `next build` is the build command and `next start` is the runtime.

4. **Verify**

   Visit `/api/health`. A healthy deployment returns:

   ```json
   { "status": "ok", "database": "connected" }
   ```

If the database variables are missing, point at a local file, or omit the token, the deployment fails loudly with an actionable error rather than silently using ephemeral storage.

> Migrations are intentionally not run during `next build`: build machines should not mutate production data. Apply them as an explicit deploy/CI step.

## Architecture

```
src/
  app/                 App Router pages, layouts, error/loading states, API routes
  components/
    board/             Board view, columns, cards, filters, dialogs, task detail sheet
    layout/            App shell and responsive sidebar
    search/            Command palette and shortcut guide
    shared/            Cross-feature UI and task metadata
    ui/                Tailwind + Radix primitives
  db/                  Schema, client, and runtime configuration
  lib/
    server/            Server-only queries and services (boards, tasks, columns, …)
    api.ts             Route-handler helpers and typed errors
    client-api.ts      Browser fetch wrapper
    validation.ts      Zod schemas for every write boundary
    task-utils.ts      Ordering, filtering, sorting, completion math
    dates.ts           Date-only and relative-time helpers
drizzle/               Generated SQL migrations and metadata
scripts/               Migrate, seed, reset, E2E reset, env loading
tests/                 Vitest unit and database integration tests
e2e/                   Playwright end-to-end suite
```

Key design decisions:

- **Server-only data access.** Query and service modules import the Drizzle client and are used from Server Components and Route Handlers. The browser talks to the app through validated JSON APIs.
- **Status is structural.** A task’s status is its column. Moving into the completion column sets `completedAt`; moving out clears it. Setting a completion column clears the flag on any previous one, so each board has exactly one.
- **Complete-set reordering.** Reorder APIs require the full ordered ID set for a board (or column list), which keeps positions deterministic and rejects partial/stale client state.
- **Single-user by design.** There is no authentication or multi-tenant isolation. Assignees and comment authors are free text, and comments default to “You”. Add auth and ownership columns before exposing an instance to multiple users.
- **Mutations are serialized in the task sheet.** Detail edits, subtasks, comments, and labels queue behind one another and apply to the latest snapshot, so a slow response cannot overwrite a newer edit.

## API overview

All write endpoints accept JSON and validate it with Zod. Errors return a consistent `{ error: string }` shape with an appropriate status code; validation failures also include a `fieldErrors` map. Boards are loaded with their columns, tasks, and labels in one response, so there are no separate collection `GET` routes for those nested resources.

| Endpoint | Methods |
| --- | --- |
| `/api/boards` | `GET`, `POST` |
| `/api/boards/:boardId` | `GET`, `PATCH`, `DELETE` |
| `/api/boards/:boardId/columns` | `POST` |
| `/api/boards/:boardId/columns/reorder` | `POST` |
| `/api/columns/:columnId` | `PATCH`, `DELETE` |
| `/api/boards/:boardId/tasks` | `POST` |
| `/api/boards/:boardId/tasks/reorder` | `POST` |
| `/api/tasks/:taskId` | `GET`, `PATCH`, `DELETE` |
| `/api/tasks/:taskId/duplicate` | `POST` |
| `/api/tasks/:taskId/subtasks` | `POST` |
| `/api/tasks/:taskId/comments` | `POST` |
| `/api/subtasks/:subtaskId` | `PATCH`, `DELETE` |
| `/api/comments/:commentId` | `DELETE` |
| `/api/boards/:boardId/labels` | `POST` |
| `/api/labels/:labelId` | `PATCH`, `DELETE` |
| `/api/search?q=…` | `GET` |
| `/api/health` | `GET` |

## Testing

```bash
npm run lint
npm run typecheck
npm test              # Vitest: unit + database integration
npx playwright install chromium
npm run test:e2e      # resets data/e2e.db, migrates, then runs Playwright
npm run verify        # lint + typecheck + unit/integration tests + production build
```

- Vitest uses an isolated temporary SQLite database (`tests/helpers/test-db.ts`), so tests never touch `data/app.db`.
- Playwright uses a disposable `data/e2e.db`, starts the dev server on port `3100`, and covers board creation, task editing, subtask/comment persistence, filters, views, command-palette search, drag-and-drop persistence, destructive confirmations, dashboard stats, mobile navigation, and dark mode.
- The E2E suite collects browser page errors and console errors and fails if any are emitted.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `⌘K` / `Ctrl K` | Open global search |
| `N` | Create a task on the current board |
| `?` | Show the shortcut guide |
| `Esc` | Close a panel, menu, or dialog |
| `Space` | Pick up a focused task drag handle |
| `⌘↵` / `Ctrl ↵` | Submit a comment |

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the dev server; applies pending migrations first. |
| `npm run build` | Production build. |
| `npm start` | Start the production server. |
| `npm run lint` | ESLint. |
| `npm run typecheck` | TypeScript with no emit. |
| `npm test` | Vitest run. |
| `npm run test:watch` | Vitest watch mode. |
| `npm run test:e2e` | Reset the E2E database and run Playwright. |
| `npm run db:generate` | Generate a Drizzle migration. |
| `npm run db:migrate` | Apply migrations. |
| `npm run db:seed` | Seed demo data. |
| `npm run db:reset` | Delete the local database and re-migrate. |
| `npm run db:studio` | Open Drizzle Studio. |
| `npm run verify` | Full lint, typecheck, test, and build pipeline. |

## License

Private project. All rights reserved.
