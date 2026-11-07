import { randomUUID } from "node:crypto";

import type { Transaction } from "@libsql/client";
import { getClient } from "@/db";

export type SyncEntityType =
  | "board"
  | "column"
  | "task"
  | "label"
  | "task_label"
  | "subtask"
  | "comment";

export interface LocalSyncChange {
  id: number;
  entityType: SyncEntityType;
  entityId: string;
  deleted: boolean;
  data: Record<string, unknown>;
  updatedAt: string;
  /**
   * The server revision this entity was last seen at, or null when the entity
   * has never round-tripped through the cloud (a brand-new local creation).
   * The push sends this so the server can resolve the edit causally.
   */
  baseRevision: number | null;
}

export interface RemoteSyncChange {
  entityType: SyncEntityType;
  entityId: string;
  deleted: boolean;
  data: Record<string, unknown>;
  updatedAt: string;
  revision?: number;
}

export interface SyncStateView {
  deviceId: string;
  remoteUserId: string | null;
  lastRevision: number;
  lastSyncedAt: string | null;
  bootstrapped: boolean;
  pendingChanges: number;
}

const ENTITY_TYPES = new Set<SyncEntityType>([
  "board",
  "column",
  "task",
  "label",
  "task_label",
  "subtask",
  "comment",
]);

function assertEntityType(value: string): SyncEntityType {
  if (!ENTITY_TYPES.has(value as SyncEntityType)) {
    throw new Error(`Unknown sync entity type: ${value}`);
  }
  return value as SyncEntityType;
}

function nowMs(): number {
  return Date.now();
}

function toMs(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 1;
}

export async function prepareSync(
  remoteUserId: string,
  resetCursor = false,
): Promise<SyncStateView> {
  const client = getClient();
  const tx = await client.transaction("write");
  try {
    const existing = await tx.execute({
      sql: "select device_id, remote_user_id, bootstrapped from sync_state where id = 1",
      args: [],
    });
    const row = existing.rows[0];
    const deviceId = typeof row?.device_id === "string" ? row.device_id : randomUUID();
    const previousRemoteUser =
      typeof row?.remote_user_id === "string" ? row.remote_user_id : null;

    // A database file is bound to exactly one premium account (the Electron
    // main process opens a dedicated mirror file per account). Re-bootstrapping
    // on an account switch used to re-queue every local row — including the
    // previous account's cloud data — into the next account's workspace. That
    // must never happen again: refuse instead.
    if (previousRemoteUser !== null && previousRemoteUser !== remoteUserId) {
      throw new Error(
        `This workspace is bound to premium account ${previousRemoteUser}. Sign out before connecting ${remoteUserId}.`,
      );
    }

    await tx.execute({
      sql: `insert into sync_state (id, device_id, remote_user_id, last_revision, last_synced_at, bootstrapped, applying)
            values (1, ?, ?, 0, null, 0, 0)
            on conflict(id) do update set
              device_id = excluded.device_id,
              remote_user_id = excluded.remote_user_id`,
      args: [deviceId, remoteUserId],
    });

    if (resetCursor) {
      // The server revision can move backwards after a restore. Keep the
      // outbox so unsynced local work is still pushed; only restart the pull
      // cursor.
      await tx.execute(
        "update sync_state set last_revision = 0, last_synced_at = null where id = 1",
      );
    }

    const bootstrapped = await tx.execute(
      "select bootstrapped from sync_state where id = 1",
    );
    if (Number(bootstrapped.rows[0]?.bootstrapped ?? 0) === 0) {
      await tx.execute("delete from sync_changes");
      await bootstrapChanges(tx);
      await tx.execute("update sync_state set bootstrapped = 1 where id = 1");
    } else {
      // While offline/disconnected the outbox can contain several updates for
      // the same entity. Only the newest state is needed because sync is
      // entity-based, not an operation journal.
      await tx.execute(
        `delete from sync_changes
         where id not in (
           select max(id) from sync_changes group by entity_type, entity_id
         )`,
      );

      // Upgrade reconciliation: an install that synced before per-entity
      // revision tracking existed has already pulled data (last_revision > 0)
      // but no revision rows. Replay the pull from zero once so every entity's
      // server revision is recorded; the outbox is preserved, so unsynced work
      // is not lost, and the retained-on-conflict push path covers edits made
      // before the backfill completes.
      if (!resetCursor) {
        const revisionCount = await tx.execute(
          "select count(*) as count from sync_entity_revisions",
        );
        const state = await tx.execute(
          "select last_revision from sync_state where id = 1",
        );
        const hasRevisions = Number(revisionCount.rows[0]?.count ?? 0) > 0;
        const lastRevision = Number(state.rows[0]?.last_revision ?? 0);
        if (!hasRevisions && lastRevision > 0) {
          await tx.execute(
            "update sync_state set last_revision = 0, last_synced_at = null where id = 1",
          );
        }
      }
    }

    await tx.commit();
    return getSyncState();
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}

async function bootstrapChanges(tx: Transaction): Promise<void> {
  const statements = [
    `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
     select 'board', id, 0,
       json_object('id', id, 'owner_id', owner_id, 'name', name, 'description', description,
                   'color', color, 'position', position, 'created_at', created_at, 'updated_at', updated_at),
       coalesce(updated_at, unixepoch() * 1000)
     from boards
     order by position, created_at`,
    `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
     select 'column', id, 0,
       json_object('id', id, 'board_id', board_id, 'name', name, 'position', position,
                   'is_done', is_done, 'created_at', created_at, 'updated_at', updated_at),
       coalesce(updated_at, unixepoch() * 1000)
     from columns
     order by board_id, position`,
    `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
     select 'label', id, 0,
       json_object('id', id, 'board_id', board_id, 'name', name, 'color', color,
                   'created_at', created_at, 'updated_at', coalesce(updated_at, created_at)),
       coalesce(updated_at, created_at, unixepoch() * 1000)
     from labels
     order by board_id, name`,
    `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
     select 'task', id, 0,
       json_object('id', id, 'board_id', board_id, 'column_id', column_id, 'title', title,
                   'description', description, 'priority', priority, 'due_date', due_date,
                   'assignee', assignee, 'position', position, 'completed_at', completed_at,
                   'created_at', created_at, 'updated_at', updated_at),
       coalesce(updated_at, unixepoch() * 1000)
     from tasks
     order by board_id, column_id, position`,
    `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
     select 'task_label', task_id || ':' || label_id, 0,
       json_object('task_id', task_id, 'label_id', label_id),
       unixepoch() * 1000
     from task_labels`,
    `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
     select 'subtask', id, 0,
       json_object('id', id, 'task_id', task_id, 'title', title, 'completed', completed,
                   'position', position, 'created_at', created_at, 'updated_at', coalesce(updated_at, created_at)),
       coalesce(updated_at, created_at, unixepoch() * 1000)
     from subtasks
     order by task_id, position`,
    `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
     select 'comment', id, 0,
       json_object('id', id, 'task_id', task_id, 'author', author, 'body', body,
                   'created_at', created_at, 'updated_at', coalesce(updated_at, created_at)),
       coalesce(updated_at, created_at, unixepoch() * 1000)
     from comments
     order by task_id, created_at`,
  ];
  for (const sql of statements) await tx.execute(sql);
}

export async function getSyncState(): Promise<SyncStateView> {
  const client = getClient();
  const state = await client.execute(
    "select device_id, remote_user_id, last_revision, last_synced_at, bootstrapped from sync_state where id = 1",
  );
  const pending = await client.execute("select count(*) as count from sync_changes");
  const row = state.rows[0];
  return {
    deviceId: typeof row?.device_id === "string" ? row.device_id : "",
    remoteUserId: typeof row?.remote_user_id === "string" ? row.remote_user_id : null,
    lastRevision: Number(row?.last_revision ?? 0),
    lastSyncedAt:
      typeof row?.last_synced_at === "number"
        ? new Date(row.last_synced_at).toISOString()
        : null,
    bootstrapped: Number(row?.bootstrapped ?? 0) === 1,
    pendingChanges: Number(pending.rows[0]?.count ?? 0),
  };
}

export async function listPendingChanges(
  afterId: number,
  limit: number,
): Promise<LocalSyncChange[]> {
  const client = getClient();
  const result = await client.execute({
    sql: `select c.id, c.entity_type, c.entity_id, c.deleted, c.data, c.updated_at,
                 r.revision as base_revision
          from sync_changes c
          left join sync_entity_revisions r
            on r.entity_type = c.entity_type and r.entity_id = c.entity_id
          where c.id > ? order by c.id asc limit ?`,
    args: [afterId, limit],
  });
  return result.rows.map((row) => {
    let data: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(String(row.data ?? "{}"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      /* Defensive: corrupt outbox rows are surfaced as empty data. */
    }
    return {
      id: Number(row.id),
      entityType: assertEntityType(String(row.entity_type)),
      entityId: String(row.entity_id),
      deleted: Number(row.deleted) === 1,
      data,
      updatedAt: new Date(Number(row.updated_at)).toISOString(),
      baseRevision:
        row.base_revision === null || row.base_revision === undefined
          ? null
          : Number(row.base_revision),
    };
  });
}

export interface RejectedChangeKey {
  entityType: string;
  entityId: string;
}

/**
 * Delete acked outbox rows up to `throughId`, except rows for entities the
 * server rejected as conflicts — those must be retained so they are re-pushed
 * with a correct base revision after the next pull records the server's
 * winning revision. Deleting a rejected row would silently drop the user's
 * edit (the original data-loss bug).
 */
export async function acknowledgeChanges(
  throughId: number,
  rejected: RejectedChangeKey[] = [],
): Promise<number> {
  if (!Number.isInteger(throughId) || throughId < 0) {
    throw new Error("throughId must be a non-negative integer");
  }
  const client = getClient();
  if (rejected.length === 0) {
    const result = await client.execute({
      sql: "delete from sync_changes where id <= ?",
      args: [throughId],
    });
    return Number(result.rowsAffected ?? 0);
  }

  // Retain every outbox row for a rejected (entity_type, entity_id) pair.
  const conditions = rejected
    .map(() => "(entity_type = ? and entity_id = ?)")
    .join(" or ");
  const args: Array<number | string> = [throughId];
  for (const key of rejected) {
    args.push(key.entityType, key.entityId);
  }
  const result = await client.execute({
    sql: `delete from sync_changes where id <= ? and not (${conditions})`,
    args,
  });
  return Number(result.rowsAffected ?? 0);
}

interface ApplyResult {
  applied: number;
  skipped: Array<{ entityType: string; entityId: string; reason: string }>;
  lastRevision: number;
}

export async function applyRemoteChanges(
  nextRevision: number,
  changes: RemoteSyncChange[],
): Promise<ApplyResult> {
  if (!Number.isInteger(nextRevision) || nextRevision < 0) {
    throw new Error("nextRevision must be a non-negative integer");
  }
  const client = getClient();
  const tx = await client.transaction("write");
  const skipped: ApplyResult["skipped"] = [];
  let applied = 0;

  try {
    await tx.execute("update sync_state set applying = 1 where id = 1");

    const deletions = changes
      .filter((change) => change.deleted)
      .sort((a, b) => dependencyRank(b.entityType) - dependencyRank(a.entityType));
    const upserts = changes
      .filter((change) => !change.deleted)
      .sort((a, b) => dependencyRank(a.entityType) - dependencyRank(b.entityType));

    for (const change of deletions) {
      await recordEntityRevision(tx, change);
      if (await keepLocalIfNewer(tx, change)) {
        skipped.push({
          entityType: change.entityType,
          entityId: change.entityId,
          reason: "Local change is newer",
        });
        continue;
      }
      await deleteEntity(tx, change);
      applied += 1;
    }

    for (const change of upserts) {
      await recordEntityRevision(tx, change);
      if (await keepLocalIfNewer(tx, change)) {
        skipped.push({
          entityType: change.entityType,
          entityId: change.entityId,
          reason: "Local change is newer",
        });
        continue;
      }
      const reason = await applyUpsert(tx, change);
      if (reason) skipped.push({ entityType: change.entityType, entityId: change.entityId, reason });
      else applied += 1;
    }

    await tx.execute({
      sql: "update sync_state set applying = 0, last_revision = ?, last_synced_at = ? where id = 1",
      args: [nextRevision, nowMs()],
    });
    await tx.commit();
    return { applied, skipped, lastRevision: nextRevision };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}

/**
 * Record the server revision a pulled change was observed at. A later local
 * edit to the same entity pushes this as its `baseRevision`, letting the
 * server prove the edit is sequential. A remote deletion drops the row: the
 * entity is gone, and any future local recreation must push as a creation
 * (null base). Changes without a revision (legacy payloads) are ignored.
 */
async function recordEntityRevision(
  tx: Transaction,
  change: RemoteSyncChange,
): Promise<void> {
  if (typeof change.revision !== "number" || !Number.isFinite(change.revision)) {
    return;
  }
  if (change.deleted) {
    await tx.execute({
      sql: "delete from sync_entity_revisions where entity_type = ? and entity_id = ?",
      args: [change.entityType, change.entityId],
    });
    return;
  }
  await tx.execute({
    sql: `insert into sync_entity_revisions (entity_type, entity_id, revision)
          values (?, ?, ?)
          on conflict(entity_type, entity_id) do update set revision = excluded.revision`,
    args: [change.entityType, change.entityId, Math.trunc(change.revision)],
  });
}

function dependencyRank(type: SyncEntityType): number {  switch (type) {
    case "board":
      return 0;
    case "column":
      return 1;
    case "label":
      return 2;
    case "task":
      return 3;
    case "task_label":
      return 4;
    case "subtask":
      return 5;
    case "comment":
      return 6;
    default:
      return 99;
  }
}

async function localTimestamp(
  tx: Transaction,
  entityType: SyncEntityType,
  entityId: string,
): Promise<number | null> {
  const queries: Record<Exclude<SyncEntityType, "task_label">, string> = {
    board: "select updated_at as value from boards where id = ?",
    column: "select updated_at as value from columns where id = ?",
    task: "select updated_at as value from tasks where id = ?",
    label: "select coalesce(updated_at, created_at) as value from labels where id = ?",
    subtask: "select coalesce(updated_at, created_at) as value from subtasks where id = ?",
    comment: "select coalesce(updated_at, created_at) as value from comments where id = ?",
  };
  if (entityType === "task_label") return null;
  const result = await tx.execute({ sql: queries[entityType], args: [entityId] });
  const value = result.rows[0]?.value;
  return typeof value === "number" ? value : null;
}

/**
 * A remote pull must not overwrite an unsynced local edit. Keep the local row,
 * queue it for the next push, and report it so the UI can explain the outcome.
 */
async function keepLocalIfNewer(
  tx: Transaction,
  change: RemoteSyncChange,
): Promise<boolean> {
  if (change.entityType === "task_label") return false;
  const remote = Date.parse(change.updatedAt);
  if (!Number.isFinite(remote)) return false;

  // A local deletion is not present in the entity table, so check the outbox
  // tombstone before an older remote update can resurrect the row.
  const tombstone = await tx.execute({
    sql: `select max(updated_at) as value from sync_changes
          where entity_type = ? and entity_id = ? and deleted = 1`,
    args: [change.entityType, change.entityId],
  });
  const deletedAt = tombstone.rows[0]?.value;
  if (typeof deletedAt === "number" && deletedAt > remote) {
    return true;
  }

  const local = await localTimestamp(tx, change.entityType, change.entityId);
  if (local === null) return false;
  if (local <= remote) return false;

  const pending = await tx.execute({
    sql: "select 1 as found from sync_changes where entity_type = ? and entity_id = ? limit 1",
    args: [change.entityType, change.entityId],
  });
  if (pending.rows.length === 0) {
    await queueCurrentEntity(tx, change.entityType, change.entityId);
  }
  return true;
}

async function queueCurrentEntity(
  tx: Transaction,
  entityType: Exclude<SyncEntityType, "task_label">,
  entityId: string,
): Promise<void> {
  const statements: Record<Exclude<SyncEntityType, "task_label">, string> = {
    board: `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
      select 'board', id, 0,
        json_object('id', id, 'owner_id', owner_id, 'name', name, 'description', description,
                    'color', color, 'position', position, 'created_at', created_at, 'updated_at', updated_at),
        coalesce(updated_at, unixepoch() * 1000)
      from boards where id = ?`,
    column: `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
      select 'column', id, 0,
        json_object('id', id, 'board_id', board_id, 'name', name, 'position', position,
                    'is_done', is_done, 'created_at', created_at, 'updated_at', updated_at),
        coalesce(updated_at, unixepoch() * 1000)
      from columns where id = ?`,
    label: `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
      select 'label', id, 0,
        json_object('id', id, 'board_id', board_id, 'name', name, 'color', color,
                    'created_at', created_at, 'updated_at', coalesce(updated_at, created_at)),
        coalesce(updated_at, created_at, unixepoch() * 1000)
      from labels where id = ?`,
    task: `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
      select 'task', id, 0,
        json_object('id', id, 'board_id', board_id, 'column_id', column_id, 'title', title,
                    'description', description, 'priority', priority, 'due_date', due_date,
                    'assignee', assignee, 'position', position, 'completed_at', completed_at,
                    'created_at', created_at, 'updated_at', updated_at),
        coalesce(updated_at, unixepoch() * 1000)
      from tasks where id = ?`,
    subtask: `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
      select 'subtask', id, 0,
        json_object('id', id, 'task_id', task_id, 'title', title, 'completed', completed,
                    'position', position, 'created_at', created_at, 'updated_at', coalesce(updated_at, created_at)),
        coalesce(updated_at, created_at, unixepoch() * 1000)
      from subtasks where id = ?`,
    comment: `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
      select 'comment', id, 0,
        json_object('id', id, 'task_id', task_id, 'author', author, 'body', body,
                    'created_at', created_at, 'updated_at', coalesce(updated_at, created_at)),
        coalesce(updated_at, created_at, unixepoch() * 1000)
      from comments where id = ?`,
  };
  await tx.execute({ sql: statements[entityType], args: [entityId] });
}

async function exists(tx: Transaction, table: string, id: string): Promise<boolean> {
  const result = await tx.execute({
    sql: `select 1 as found from ${table} where id = ? limit 1`,
    args: [id],
  });
  return result.rows.length > 0;
}

async function deleteEntity(tx: Transaction, change: RemoteSyncChange): Promise<void> {
  switch (change.entityType) {
    case "board":
      await tx.execute({ sql: "delete from boards where id = ?", args: [change.entityId] });
      break;
    case "column":
      await tx.execute({ sql: "delete from columns where id = ?", args: [change.entityId] });
      break;
    case "task":
      await tx.execute({ sql: "delete from tasks where id = ?", args: [change.entityId] });
      break;
    case "label":
      await tx.execute({ sql: "delete from labels where id = ?", args: [change.entityId] });
      break;
    case "task_label": {
      const [fallbackTask, fallbackLabel] = change.entityId.split(":", 2);
      const taskId = asString(change.data.task_id, fallbackTask ?? "");
      const labelId = asString(change.data.label_id, fallbackLabel ?? "");
      await tx.execute({
        sql: "delete from task_labels where task_id = ? and label_id = ?",
        args: [taskId, labelId],
      });
      break;
    }
    case "subtask":
      await tx.execute({ sql: "delete from subtasks where id = ?", args: [change.entityId] });
      break;
    case "comment":
      await tx.execute({ sql: "delete from comments where id = ?", args: [change.entityId] });
      break;
  }
}

async function applyUpsert(
  tx: Transaction,
  change: RemoteSyncChange,
): Promise<string | null> {
  const data = change.data;
  const now = nowMs();

  switch (change.entityType) {
    case "board": {
      await tx.execute({
        sql: `insert into boards (id, owner_id, name, description, color, position, created_at, updated_at)
              values (?, 'local-user', ?, ?, ?, ?, ?, ?)
              on conflict(id) do update set
                owner_id = 'local-user', name = excluded.name, description = excluded.description,
                color = excluded.color, position = excluded.position, updated_at = excluded.updated_at`,
        args: [
          change.entityId,
          asString(data.name, "Untitled board"),
          asNullableString(data.description),
          asString(data.color, "sage"),
          asNumber(data.position),
          toMs(data.created_at, now),
          toMs(data.updated_at, now),
        ],
      });
      return null;
    }
    case "column": {
      const boardId = asString(data.board_id);
      if (!(await exists(tx, "boards", boardId))) return "Parent board no longer exists";
      await tx.execute({
        sql: `insert into columns (id, board_id, name, position, is_done, created_at, updated_at)
              values (?, ?, ?, ?, ?, ?, ?)
              on conflict(id) do update set
                board_id = excluded.board_id, name = excluded.name, position = excluded.position,
                is_done = excluded.is_done, updated_at = excluded.updated_at`,
        args: [
          change.entityId,
          boardId,
          asString(data.name, "Untitled"),
          asNumber(data.position),
          asBoolean(data.is_done) ? 1 : 0,
          toMs(data.created_at, now),
          toMs(data.updated_at, now),
        ],
      });
      return null;
    }
    case "label": {
      const boardId = asString(data.board_id);
      if (!(await exists(tx, "boards", boardId))) return "Parent board no longer exists";
      await tx.execute({
        sql: `insert into labels (id, board_id, name, color, created_at, updated_at)
              values (?, ?, ?, ?, ?, ?)
              on conflict(id) do update set
                board_id = excluded.board_id, name = excluded.name, color = excluded.color,
                updated_at = excluded.updated_at`,
        args: [
          change.entityId,
          boardId,
          asString(data.name, "Label"),
          asString(data.color, "slate"),
          toMs(data.created_at, now),
          toMs(data.updated_at, toMs(data.created_at, now)),
        ],
      });
      return null;
    }
    case "task": {
      const boardId = asString(data.board_id);
      const columnId = asString(data.column_id);
      if (!(await exists(tx, "boards", boardId))) return "Parent board no longer exists";
      if (!(await exists(tx, "columns", columnId))) return "Parent column no longer exists";
      await tx.execute({
        sql: `insert into tasks (id, board_id, column_id, title, description, priority, due_date, assignee, position, completed_at, created_at, updated_at)
              values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              on conflict(id) do update set
                board_id = excluded.board_id, column_id = excluded.column_id, title = excluded.title,
                description = excluded.description, priority = excluded.priority,
                due_date = excluded.due_date, assignee = excluded.assignee,
                position = excluded.position, completed_at = excluded.completed_at,
                updated_at = excluded.updated_at`,
        args: [
          change.entityId,
          boardId,
          columnId,
          asString(data.title, "Untitled task"),
          asNullableString(data.description),
          asString(data.priority, "none"),
          asNullableString(data.due_date),
          asNullableString(data.assignee),
          asNumber(data.position),
          data.completed_at === null || data.completed_at === undefined
            ? null
            : toMs(data.completed_at, now),
          toMs(data.created_at, now),
          toMs(data.updated_at, now),
        ],
      });
      return null;
    }
    case "task_label": {
      const taskId = asString(data.task_id);
      const labelId = asString(data.label_id);
      if (!(await exists(tx, "tasks", taskId))) return "Parent task no longer exists";
      if (!(await exists(tx, "labels", labelId))) return "Parent label no longer exists";
      await tx.execute({
        sql: "insert into task_labels (task_id, label_id) values (?, ?) on conflict do nothing",
        args: [taskId, labelId],
      });
      return null;
    }
    case "subtask": {
      const taskId = asString(data.task_id);
      if (!(await exists(tx, "tasks", taskId))) return "Parent task no longer exists";
      await tx.execute({
        sql: `insert into subtasks (id, task_id, title, completed, position, created_at, updated_at)
              values (?, ?, ?, ?, ?, ?, ?)
              on conflict(id) do update set
                task_id = excluded.task_id, title = excluded.title, completed = excluded.completed,
                position = excluded.position, updated_at = excluded.updated_at`,
        args: [
          change.entityId,
          taskId,
          asString(data.title, "Subtask"),
          asBoolean(data.completed) ? 1 : 0,
          asNumber(data.position),
          toMs(data.created_at, now),
          toMs(data.updated_at, toMs(data.created_at, now)),
        ],
      });
      return null;
    }
    case "comment": {
      const taskId = asString(data.task_id);
      if (!(await exists(tx, "tasks", taskId))) return "Parent task no longer exists";
      await tx.execute({
        sql: `insert into comments (id, task_id, author, body, created_at, updated_at)
              values (?, ?, ?, ?, ?, ?)
              on conflict(id) do update set
                task_id = excluded.task_id, author = excluded.author, body = excluded.body,
                updated_at = excluded.updated_at`,
        args: [
          change.entityId,
          taskId,
          asString(data.author, "You"),
          asString(data.body, ""),
          toMs(data.created_at, now),
          toMs(data.updated_at, toMs(data.created_at, now)),
        ],
      });
      return null;
    }
  }
}

