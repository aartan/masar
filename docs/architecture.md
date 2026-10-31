# Architecture and migration notes

## Before

Masar was a single Next.js application:

- Next.js App Router rendered the UI and hosted every API route.
- Better Auth, Stripe billing, entitlement checks and board data lived in the
  same codebase.
- Desktop Electron forked the Next.js standalone server and used a local SQLite
  file for the free offline mode.
- "Sync mode" loaded the centrally hosted website. It did not synchronise the
  local desktop workspace.

The former hosted deployment and Chrome/web workflow have been retired.

## After

Two independently deployable projects:

### Desktop (`masar`)

- Vite React SPA with React Router.
- Electron main process, secure preload bridge and OS integrations.
- Loopback-only Hono local API that reuses the Drizzle/SQLite data services.
- Local API serves the built SPA and JSON API on the same origin.
- SQLite remains the primary datastore and source of truth while offline.
- Premium session tokens stay in Electron main, encrypted with `safeStorage`.

### Premium Sync API (`masar-sync-api`)

- Node.js + TypeScript + Hono.
- PostgreSQL through Knex 3, with up/down migrations.
- Dedicated PostgreSQL schema (`masar_sync` by default) so the existing `masar`
  database can be used without modifying other data.
- Opaque bearer sessions, scrypt password hashes, Stripe Checkout/Portal,
  webhook processing and entitlement evaluation.
- Per-entity sync storage with monotonic revisions, conflict records and
  idempotent push requests.

## What was retained

- SQLite schema and data, including all existing board/task relationships.
- Drizzle data access and business services for boards, columns, tasks, labels,
  subtasks, comments, search and dashboard.
- UI components, design system, drag-and-drop, filters, themes and responsive
  behaviour.
- Electron lifecycle, menu, context isolation, sandboxing, packaging targets
  for macOS, Windows and Linux.
- Existing Stripe price/trial concepts, moved into the API.

## What moved

- Accounts, sessions, password hashing and login.
- Stripe customers, subscriptions, Checkout, Customer Portal and webhooks.
- Entitlement rules and subscription status.
- Remote sync storage, revision history and conflict diagnostics.

No Stripe key, subscription rule or entitlement decision remains in the desktop
application.

## Local data changes

Migration `0003_stormy_robin_chapel.sql` adds:

- `sync_state`: device id, remote user, pull cursor, bootstrap/applying flags.
- `sync_changes`: an outbox fed by SQLite triggers for every local mutation.
- `updated_at` on labels, subtasks and comments, plus backfill from
  `created_at`.

Triggers suppress themselves while remote changes are being applied, preventing
sync echo loops. On first sync, bootstrap queues every existing local entity so
no local work is lost.

Older unowned boards and boards parked behind the `legacy-workspace` account are
claimed by the implicit `local-user` account on startup.

## Sync flow

1. Desktop pushes pending outbox batches with an idempotency key.
2. API applies changes per entity with last-write-wins timestamps. The server
   wins exact ties and records rejected changes in `conflicts`.
3. Each accepted change receives a monotonic revision.
4. Desktop pulls changes after its cursor and applies them in dependency order.
5. If a pulled change is older than a newer unsynced local row, the local row is
   kept and queued for the next push.
6. Cursor and outbox are updated in the same SQLite transaction as the applied
   remote batch.
7. Duplicate pushes are ignored by timestamp/data equality; interrupted network
   calls can be retried safely.

## Known limitations

- Per-entity LWW uses client clocks. Clock skew can decide a conflict in favour
  of the wrong side. A future version could use server-side vector clocks or
  operation transforms for text fields.
- `task_label` rows are relationships without their own timestamp; remote
  relationship changes currently win during pull.
- Existing hosted accounts and Turso subscriptions are not migrated. Users
  create new API accounts; local data syncs normally afterwards.
- In-memory rate limiting is per API process; use a proxy/shared store for
  multi-instance deployments.
- Linux token encryption needs a system keyring. `MASAR_ALLOW_PLAINTEXT_TOKEN=1`
  is an explicit development-only fallback.
