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
sync echo loops. On the first sync of a mirror, bootstrap queues every existing
entity in that mirror so no local work is lost.

Migration `0004_daily_shen.sql` adds causality tracking:

- `sync_entity_state`: the server revision each entity was last seen at.
- `sync_changes.base_revision`: the revision a queued change was based on
  (`null` for new entities, `-1` for pre-causality legacy rows).
- Triggers recreated to record the base, and existing entities backfilled with
  the legacy base.

Older unowned boards and boards parked behind the `legacy-workspace` account are
claimed by the implicit `local-user` account on startup.

## Workspace separation

Local and premium workspaces are separate databases, exactly like the original
two-mode desktop app:

- The local workspace lives in `masar.db` and is never read or written by
  sync. It is what the app shows while signed out.
- Every premium account gets its own mirror database `sync/<user-id>.db`.
  The Electron main process restarts the loopback API against the matching
  database on sign-in, sign-out and session expiry, then reloads the renderer.
- `MASAR_SYNC_SCOPE` binds an API process to one premium account; the sync
  routes refuse to mutate any database without a matching scope, so sync can
  never write into the local workspace (or another account's mirror), even if
  a request races a workspace switch.
- Local data only enters the cloud through the explicit "Import local
  workspace" action, which copies the local database into the mirror (re-owning
  boards and queueing changes for the next push). Signing in never uploads
  local data by itself.

Upgrading from the broken single-database build: rows it synced into the local
workspace stay there (nothing is deleted); the cloud copy remains authoritative
and is pulled fresh into the new mirror on the next sign-in.

## Sync flow

1. Desktop pushes pending outbox batches with an idempotency key. Every pushed
   change carries the revision of the server state it was based on (recorded
   locally when remote changes are applied; `null` for brand-new entities, `-1`
   for pre-causality legacy rows).
2. API resolves conflicts causally, never with client clocks: a change whose
   base revision matches the current entity revision is a sequential edit and
   applies; a stale base (or no base on an existing entity) is rejected and
   recorded in `conflicts`. Accepted changes are stamped with the server's own
   clock.
3. Each accepted change receives a monotonic revision.
4. Desktop pulls changes after its cursor and applies them in dependency order,
   recording each applied revision as the entity's new base.
5. Rejected pushes converge by pulling the server's winning version; the losing
   concurrent edit is preserved in the API's `conflicts` table.
6. Cursor and outbox are updated in the same SQLite transaction as the applied
   remote batch.
7. Duplicate pushes are ignored by data equality; interrupted network calls can
   be retried safely.

A mirror's pull cursor and outbox persist across restarts, so an interrupted or
offline sync resumes where it left off. A fresh machine starts with an empty
mirror (cursor 0) and pulls the complete workspace from the API.

## Known limitations

- Concurrent offline edits of the same entity are resolved by arrival order:
  the first accepted push wins and the losing edit is rejected and recorded in
  `conflicts` (with its full payload) rather than merged. Per-field merging or
  CRDTs could improve this in the future.
- The `-1` legacy base means the first post-upgrade edit of a pre-causality
  entity is still resolved by arrival order; every subsequent edit is causal.
- Existing hosted accounts and Turso subscriptions are not migrated. Users
  create new API accounts; local data syncs normally afterwards.
- In-memory rate limiting is per API process; use a proxy/shared store for
  multi-instance deployments.
- Linux token encryption needs a system keyring. `MASAR_ALLOW_PLAINTEXT_TOKEN=1`
  is an explicit development-only fallback.
- In development mode the renderer keeps showing the dev API's workspace while
  the sync engine talks to a dedicated mirror; see `desktop/scripts/dev.ts`.
