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
