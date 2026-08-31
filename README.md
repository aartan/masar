# Masar

Masar is a Kanban app for organizing projects. It has boards with ordered columns, tasks with labels, subtasks, comments, priorities, due dates, and assignees, plus a dashboard for upcoming work and progress.

Masar is the Arabic word for path, route, or course. The name reflects the app's main job: giving work a clear path from backlog to completion.

It's a single-user app. There is no login, team management, or permissions. Data lives in SQLite locally or Turso when deployed.

Built with Next.js, React, Tailwind CSS, Drizzle, SQLite/libSQL, dnd-kit, Zod, Vitest, and Playwright.

![Masar dashboard](docs/screenshots/dashboard.png)

## Features

- Boards and columns: create, rename, recolor, reorder, and delete them. Each board has one done column. Deleting a column moves its tasks to the first remaining column.
- Tasks: create inline or in a dialog, then edit the title, description, priority, due date, assignee, labels, subtasks, and comments. Duplicate or delete tasks when needed.
- Drag and drop: move tasks within or between columns with a pointer or keyboard. The order is saved. Reordering is disabled while filters or non-manual sorting are active.
- Views: switch between board and list views. The choice is saved in the browser.
- Search and filters: search the current board, filter by priority, label, due date, or status, and sort manually, by due date, priority, or newest. Cmd/Ctrl+K opens global search.
- Dashboard: open tasks, due this week, completed in the last seven days, active boards, upcoming work, priority breakdown, workload by assignee, recent tasks, and board progress.
- Themes and layout: light, dark, and system themes, a responsive sidebar, mobile navigation, toasts, and confirmation dialogs.
- Data: SQLite locally, Turso when deployed, with migrations, foreign keys, indexes, and transactions.

## Screenshots

### Board

![Masar board](docs/screenshots/board.png)

### Task details

![Task details](docs/screenshots/task-detail.png)

### List view

![List view](docs/screenshots/list-view.png)

### Dark theme

![Masar board in dark mode](docs/screenshots/board-dark.png)

## Running locally

You need Node.js 20.9 or newer and npm.

```bash
npm install
cp .env.example .env.local   # optional
npm run db:migrate
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The app uses `./data/app.db` by default. `npm run dev` applies pending migrations before starting. The seed skips when boards already exist. To replace local data with the demo workspace, run `npm run db:seed -- --force`. To delete the local database and start over, run `npm run db:reset`.

### Environment variables

Local development doesn't need any configuration. These variables are available:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | `file:./data/app.db` locally or a hosted `libsql://…` URL. Required on Vercel. |
| `TURSO_DATABASE_URL` | Alias for `DATABASE_URL`. |
| `TURSO_AUTH_TOKEN` | Auth token for a hosted Turso database. |
| `DATABASE_AUTH_TOKEN` | Alias for `TURSO_AUTH_TOKEN`. |
| `ALLOW_LOCAL_DB_IN_PRODUCTION` | Suppresses the local-file warning in a non-Vercel production runtime. Don't set it on Vercel. |

Copy `.env.example` to `.env.local` if you need overrides. `.env.local` takes precedence over `.env`.

`src/db/config.ts` picks the database. On Vercel, the app needs `DATABASE_URL` and an auth token. If they are missing or point to a local file, it fails with a configuration error instead of writing to temporary storage.

### Database commands

| Command | What it does |
| --- | --- |
| `npm run db:migrate` | Apply pending migrations. |
| `npm run db:seed` | Insert the demo workspace when no boards exist. |
| `npm run db:seed -- --force` | Replace all data with the demo workspace. |
| `npm run db:reset` | Delete the local database and re-run migrations. |
| `npm run db:generate` | Generate a migration after schema changes. |
| `npm run db:studio` | Open Drizzle Studio. |

## Deploying

Masar needs a hosted Turso/libSQL database when it is deployed. These steps use Vercel, but the same environment variables work on other Node hosts.

1. Create a Turso database and token:

   ```bash
   turso db create masar
   turso db show masar --url
   turso db tokens create masar
   ```

2. Apply migrations before the first deploy and after adding migrations:

   ```bash
   DATABASE_URL="libsql://masar-<org>.turso.io" \
   TURSO_AUTH_TOKEN="<token>" \
   npm run db:migrate
   ```

   The same command works in CI. You can seed demo data with `npm run db:seed`, but only use `-- --force` if you want to replace the data in that database.

3. Add `DATABASE_URL` and `TURSO_AUTH_TOKEN` to the Production and Preview environments in Vercel.

4. Deploy the repository. Vercel runs `next build` and `next start`.

5. Check `/api/health`. A healthy deployment returns:

   ```json
   { "status": "ok", "database": "connected" }
   ```

Migrations do not run during `next build`. Apply them as a separate deploy or CI step.

## Tests

```bash
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run verify
```

Vitest uses a temporary SQLite database, so tests don't touch `data/app.db`. Playwright uses `data/e2e.db`, starts the dev server on port 3100, and covers the main board workflows. `npm run verify` runs lint, typecheck, tests, and a build.

## License

Private project. All rights reserved.
