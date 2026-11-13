import { randomUUID } from "node:crypto";

import type { Transaction } from "@libsql/client";
import { getClient } from "@/db";

export type SyncEntityType =
  | "project"
  | "folder"
  | "board"
  | "column"
  | "task"
  | "label"
  | "task_label"
  | "subtask"
  | "comment"
  | "whiteboard"
  | "note"
  | "task_image";

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
  conflictCount: number;
}

export interface RemoteConflict {
  id: string;
  entityType: SyncEntityType;
  entityId: string;
  incomingDeleted: boolean;
  incomingData: Record<string, unknown>;
  incomingUpdatedAt: string;
  winningDeleted: boolean;
  winningData: Record<string, unknown>;
  winningUpdatedAt: string;
  revision: number;
  createdAt: string;
}

export interface LocalConflictView extends RemoteConflict {
  projectId: string | null;
  projectName: string | null;
  boardId: string | null;
  boardName: string | null;
  entityLabel: string | null;
}

export interface RemoteEntitySnapshot {
  deleted: boolean;
  data: Record<string, unknown>;
  updatedAt: string;
  revision: number;
}

const ENTITY_TYPES = new Set<SyncEntityType>([
  "project",
  "folder",
  "board",
  "column",
  "task",
  "label",
  "task_label",
  "subtask",
  "comment",
  "whiteboard",
  "note",
  "task_image",
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
      // server revision is recorded; the outbox is preserved so the conflict
      // inbox can surface anything that diverged before the backfill completes.
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
     select 'project', id, 0,
       json_object('id', id, 'owner_id', owner_id, 'name', name, 'description', description,
                   'position', position, 'archived', archived, 'archived_at', archived_at,
                   'created_at', created_at, 'updated_at', updated_at),
       coalesce(updated_at, unixepoch() * 1000)
     from projects
     order by position, created_at`,
    // Parent folders must be pushed before their children. The recursive CTE
    // orders the tree by path; the fallback catches orphaned/corrupt rows so no
    // folder is silently omitted from a bootstrap.
    `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
     with recursive tree(id, path) as (
       select id, printf('%012d/%s', position, id) from folders where parent_id is null
       union all
       select f.id, tree.path || '/' || printf('%012d/%s', f.position, f.id)
       from folders f join tree on f.parent_id = tree.id
     )
     select 'folder', f.id, 0,
       json_object('id', f.id, 'owner_id', f.owner_id, 'project_id', f.project_id,
                   'parent_id', f.parent_id, 'name', f.name, 'position', f.position,
                   'created_at', f.created_at, 'updated_at', f.updated_at),
       coalesce(f.updated_at, unixepoch() * 1000)
     from tree join folders f on f.id = tree.id
     order by tree.path`,
    `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
     select 'folder', id, 0,
       json_object('id', id, 'owner_id', owner_id, 'project_id', project_id,
                   'parent_id', parent_id, 'name', name, 'position', position,
                   'created_at', created_at, 'updated_at', updated_at),
       coalesce(updated_at, unixepoch() * 1000)
     from folders
     where id not in (select entity_id from sync_changes where entity_type = 'folder')`,
    `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
     select 'board', id, 0,
       json_object('id', id, 'owner_id', owner_id, 'project_id', project_id,
                   'folder_id', folder_id, 'type', type,
                   'name', name, 'description', description,
                   'position', position, 'created_at', created_at, 'updated_at', updated_at),
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
                   'description', description, 'priority', priority, 'complexity', complexity,
                   'due_date', due_date, 'assignee', assignee, 'position', position,
                   'completed_at', completed_at, 'created_at', created_at, 'updated_at', updated_at),
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
    `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
     select 'whiteboard', board_id, 0,
       json_object('id', board_id, 'board_id', board_id, 'scene', scene, 'updated_at', updated_at),
       coalesce(updated_at, unixepoch() * 1000)
     from whiteboards`,
    `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
     select 'note', board_id, 0,
       json_object('id', board_id, 'board_id', board_id, 'document', document, 'updated_at', updated_at),
       coalesce(updated_at, unixepoch() * 1000)
     from notes`,
    `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
     select 'task_image', id, 0,
       json_object('id', id, 'task_id', task_id, 'url', url, 'name', name,
                   'position', position, 'created_at', created_at, 'updated_at', updated_at),
       coalesce(updated_at, created_at, unixepoch() * 1000)
     from task_images
     order by task_id, position`,
  ];
  for (const sql of statements) await tx.execute(sql);
}

export async function getSyncState(): Promise<SyncStateView> {
  const client = getClient();
  const state = await client.execute(
    "select device_id, remote_user_id, last_revision, last_synced_at, bootstrapped from sync_state where id = 1",
  );
  const [pending, conflicts] = await Promise.all([
    client.execute("select count(*) as count from sync_changes"),
    client.execute("select count(*) as count from sync_conflicts"),
  ]);
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
    conflictCount: Number(conflicts.rows[0]?.count ?? 0),
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

export interface AcceptedSyncChange {
  entityType: SyncEntityType;
  entityId: string;
  revision: number;
}

/**
 * Record the revisions the server assigned to accepted pushes and delete the
 * acknowledged outbox rows in one transaction. Recording the revision here —
 * instead of waiting for the pull — means edits queued between a successful
 * push and the next pull (rapid consecutive card moves) already carry the
 * correct base revision and cannot be rejected as self-conflicts.
 */
export async function acknowledgeChanges(
  throughId: number,
  accepted: AcceptedSyncChange[] = [],
): Promise<number> {
  if (!Number.isInteger(throughId) || throughId < 0) {
    throw new Error("throughId must be a non-negative integer");
  }
  const client = getClient();
  const tx = await client.transaction("write");
  try {
    for (const change of accepted) {
      const entityType = assertEntityType(change.entityType);
      const revision = Math.trunc(change.revision);
      if (!Number.isInteger(revision) || revision < 0) {
        throw new Error("accepted revisions must be non-negative integers");
      }
      // Revisions only move forward: a replayed or duplicate ack must never
      // regress an entity below a revision the pull already recorded.
      await tx.execute({
        sql: `insert into sync_entity_revisions (entity_type, entity_id, revision)
              values (?, ?, ?)
              on conflict(entity_type, entity_id) do update set
                revision = max(revision, excluded.revision)`,
        args: [entityType, change.entityId, revision],
      });
    }
    const result = await tx.execute({
      sql: "delete from sync_changes where id <= ?",
      args: [throughId],
    });
    await tx.commit();
    return Number(result.rowsAffected ?? 0);
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
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
    const folderDepths = folderUpsertDepths(changes);
    const upserts = changes
      .filter((change) => !change.deleted)
      .sort((a, b) => {
        const rank =
          dependencyRank(a.entityType) - dependencyRank(b.entityType);
        if (rank !== 0) return rank;
        if (a.entityType === "folder" && b.entityType === "folder") {
          return (
            (folderDepths.get(a.entityId) ?? 0) -
            (folderDepths.get(b.entityId) ?? 0)
          );
        }
        return 0;
      });

    for (const change of deletions) {
      if (await hasUnresolvedConflict(tx, change.entityType, change.entityId)) {
        skipped.push({
          entityType: change.entityType,
          entityId: change.entityId,
          reason: "Conflict awaiting resolution",
        });
        continue;
      }
      if (await keepLocalIfNewer(tx, change)) {
        // The local row wins for now; keep the tombstone revision so the
        // queued edit can causally supersede it on the next push.
        await storeEntityRevision(tx, change);
        skipped.push({
          entityType: change.entityType,
          entityId: change.entityId,
          reason: "Local change is newer",
        });
        continue;
      }
      await deleteEntity(tx, change);
      await deleteEntityRevision(tx, change);
      applied += 1;
    }

    for (const change of upserts) {
      if (await hasUnresolvedConflict(tx, change.entityType, change.entityId)) {
        skipped.push({
          entityType: change.entityType,
          entityId: change.entityId,
          reason: "Conflict awaiting resolution",
        });
        continue;
      }
      await storeEntityRevision(tx, change);
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

function parseJsonObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

export async function listSyncConflicts(): Promise<LocalConflictView[]> {
  const client = getClient();
  const result = await client.execute(
    `select * from sync_conflicts order by created_at desc, id desc`,
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    entityType: assertEntityType(String(row.entity_type)),
    entityId: String(row.entity_id),
    incomingDeleted: Number(row.local_deleted) === 1,
    incomingData: parseJsonObject(row.local_data),
    incomingUpdatedAt: new Date(Number(row.local_updated_at)).toISOString(),
    winningDeleted: Number(row.cloud_deleted) === 1,
    winningData: parseJsonObject(row.cloud_data),
    winningUpdatedAt: new Date(Number(row.cloud_updated_at)).toISOString(),
    revision: Number(row.winning_revision),
    createdAt: new Date(Number(row.created_at)).toISOString(),
    projectId: typeof row.project_id === "string" ? row.project_id : null,
    projectName: typeof row.project_name === "string" ? row.project_name : null,
    boardId: typeof row.board_id === "string" ? row.board_id : null,
    boardName: typeof row.board_name === "string" ? row.board_name : null,
    entityLabel:
      typeof row.entity_label === "string" ? row.entity_label : null,
  }));
}

interface ConflictContext {
  projectId: string | null;
  projectName: string | null;
  boardId: string | null;
  boardName: string | null;
  entityLabel: string | null;
}

async function conflictContext(
  tx: Transaction,
  entityType: SyncEntityType,
  entityId: string,
  data: Record<string, unknown>,
): Promise<ConflictContext> {
  const empty: ConflictContext = {
    projectId: null,
    projectName: null,
    boardId: null,
    boardName: null,
    entityLabel: null,
  };
  const boardContext = async (boardId: string): Promise<ConflictContext> => {
    const result = await tx.execute({
      sql: `select b.id as board_id, b.name as board_name,
                   p.id as project_id, p.name as project_name
            from boards b left join projects p on p.id = b.project_id
            where b.id = ? limit 1`,
      args: [boardId],
    });
    const row = result.rows[0];
    return {
      ...empty,
      boardId: typeof row?.board_id === "string" ? row.board_id : boardId,
      boardName: typeof row?.board_name === "string" ? row.board_name : null,
      projectId: typeof row?.project_id === "string" ? row.project_id : null,
      projectName:
        typeof row?.project_name === "string" ? row.project_name : null,
    };
  };
  const taskContext = async (taskId: string): Promise<ConflictContext> => {
    const result = await tx.execute({
      sql: `select t.board_id from tasks t where t.id = ? limit 1`,
      args: [taskId],
    });
    const boardId = result.rows[0]?.board_id;
    return typeof boardId === "string"
      ? boardContext(boardId)
      : empty;
  };

  switch (entityType) {
    case "project": {
      const result = await tx.execute({
        sql: "select name from projects where id = ? limit 1",
        args: [entityId],
      });
      const name =
        typeof result.rows[0]?.name === "string"
          ? result.rows[0].name
          : asNullableString(data.name);
      return {
        ...empty,
        projectId: entityId,
        projectName: name,
        entityLabel: name,
      };
    }
    case "folder": {
      const result = await tx.execute({
        sql: `select f.name, f.project_id, p.name as project_name
              from folders f left join projects p on p.id = f.project_id
              where f.id = ? limit 1`,
        args: [entityId],
      });
      const row = result.rows[0];
      return {
        ...empty,
        projectId:
          typeof row?.project_id === "string"
            ? row.project_id
            : asNullableString(data.project_id),
        projectName:
          typeof row?.project_name === "string" ? row.project_name : null,
        entityLabel:
          typeof row?.name === "string"
            ? row.name
            : asNullableString(data.name),
      };
    }
    case "board": {
      const context = await boardContext(entityId);
      return {
        ...context,
        entityLabel: context.boardName ?? asNullableString(data.name),
      };
    }
    case "whiteboard": {
      const context = await boardContext(
        asString(data.board_id, entityId),
      );
      return {
        ...context,
        entityLabel: context.boardName ?? "Whiteboard",
      };
    }
    case "note": {
      const context = await boardContext(
        asString(data.board_id, entityId),
      );
      return {
        ...context,
        entityLabel: context.boardName ?? "Note",
      };
    }
    case "column": {
      const context = await boardContext(asString(data.board_id));
      return { ...context, entityLabel: asNullableString(data.name) };
    }
    case "label": {
      const context = await boardContext(asString(data.board_id));
      return { ...context, entityLabel: asNullableString(data.name) };
    }
    case "task": {
      const context = await taskContext(entityId);
      return { ...context, entityLabel: asNullableString(data.title) };
    }
    case "task_label": {
      const context = await taskContext(asString(data.task_id));
      const labelId = asString(
        data.label_id,
        entityId.split(":", 2)[1] ?? "",
      );
      const label = labelId
        ? await tx.execute({
            sql: "select name from labels where id = ? limit 1",
            args: [labelId],
          })
        : null;
      const name =
        typeof label?.rows[0]?.name === "string"
          ? label.rows[0].name
          : "Task label";
      return { ...context, entityLabel: name };
    }
    case "subtask": {
      const context = await taskContext(asString(data.task_id));
      return { ...context, entityLabel: asNullableString(data.title) };
    }
    case "comment": {
      const context = await taskContext(asString(data.task_id));
      return { ...context, entityLabel: asNullableString(data.body) };
    }
    case "task_image": {
      const taskId = asString(data.task_id, "");
      if (taskId) {
        const context = await taskContext(taskId);
        return {
          ...context,
          entityLabel: asNullableString(data.name) ?? "Task image",
        };
      }
      const result = await tx.execute({
        sql: "select task_id from task_images where id = ? limit 1",
        args: [entityId],
      });
      const fallback = result.rows[0]?.task_id;
      const context =
        typeof fallback === "string" ? await taskContext(fallback) : empty;
      return { ...context, entityLabel: "Task image" };
    }
  }
}

/**
 * Persist the server's conflict snapshots locally. The outbox row is removed
 * by the normal ack after this succeeds; pull then leaves the entity alone
 * until the user chooses a version.
 */
export async function recordSyncConflicts(
  conflicts: RemoteConflict[],
): Promise<number> {
  if (conflicts.length === 0) return 0;
  const client = getClient();
  const tx = await client.transaction("write");
  try {
    let recorded = 0;
    for (const conflict of conflicts) {
      const entityType = assertEntityType(conflict.entityType);
      const context = await conflictContext(
        tx,
        entityType,
        conflict.entityId,
        conflict.incomingData,
      );
      await tx.execute({
        sql: `insert into sync_conflicts
              (id, entity_type, entity_id, local_data, local_deleted, local_updated_at,
               cloud_data, cloud_deleted, cloud_updated_at, winning_revision,
               project_id, project_name, board_id, board_name, entity_label, created_at)
              values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              on conflict(id) do update set
                local_data = excluded.local_data, local_deleted = excluded.local_deleted,
                local_updated_at = excluded.local_updated_at,
                cloud_data = excluded.cloud_data, cloud_deleted = excluded.cloud_deleted,
                cloud_updated_at = excluded.cloud_updated_at,
                winning_revision = excluded.winning_revision,
                project_id = excluded.project_id, project_name = excluded.project_name,
                board_id = excluded.board_id, board_name = excluded.board_name,
                entity_label = excluded.entity_label`,
        args: [
          conflict.id,
          entityType,
          conflict.entityId,
          stringifyJson(conflict.incomingData),
          conflict.incomingDeleted ? 1 : 0,
          toMs(conflict.incomingUpdatedAt, nowMs()),
          stringifyJson(conflict.winningData),
          conflict.winningDeleted ? 1 : 0,
          toMs(conflict.winningUpdatedAt, nowMs()),
          Math.trunc(conflict.revision),
          context.projectId,
          context.projectName,
          context.boardId,
          context.boardName,
          context.entityLabel,
          toMs(conflict.createdAt, nowMs()),
        ],
      });
      recorded += 1;
    }
    await tx.commit();
    return recorded;
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}

/** Apply the latest cloud snapshot and discard the local conflicting edit. */
export async function applyCloudConflict(
  conflictId: string,
  latest?: RemoteEntitySnapshot,
): Promise<void> {
  const client = getClient();
  const tx = await client.transaction("write");
  try {
    const result = await tx.execute({
      sql: "select * from sync_conflicts where id = ? limit 1",
      args: [conflictId],
    });
    const row = result.rows[0];
    if (!row) throw new Error("Conflict not found.");
    const entityType = assertEntityType(String(row.entity_type));
    const entityId = String(row.entity_id);
    const deleted = latest?.deleted ?? Number(row.cloud_deleted) === 1;
    const data = latest?.data ?? parseJsonObject(row.cloud_data);
    const revision =
      latest?.revision ?? Number(row.winning_revision);
    const updatedAt = latest?.updatedAt ??
      new Date(Number(row.cloud_updated_at)).toISOString();

    await tx.execute("update sync_state set applying = 1 where id = 1");
    await tx.execute({
      sql: "delete from sync_changes where entity_type = ? and entity_id = ?",
      args: [entityType, entityId],
    });

    if (deleted) {
      await deleteEntity(tx, {
        entityType,
        entityId,
        deleted: true,
        data,
        updatedAt,
        revision,
      });
      await tx.execute({
        sql: "delete from sync_entity_revisions where entity_type = ? and entity_id = ?",
        args: [entityType, entityId],
      });
    } else {
      const reason = await applyUpsert(tx, {
        entityType,
        entityId,
        deleted: false,
        data,
        updatedAt,
        revision,
      });
      if (reason) throw new Error(reason);
      await tx.execute({
        sql: `insert into sync_entity_revisions (entity_type, entity_id, revision)
              values (?, ?, ?)
              on conflict(entity_type, entity_id) do update set revision = excluded.revision`,
        args: [entityType, entityId, Math.trunc(revision)],
      });
    }

    await tx.execute({
      sql: "delete from sync_conflicts where id = ?",
      args: [conflictId],
    });
    await tx.execute("update sync_state set applying = 0 where id = 1");
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}

/** Requeue the local conflicting snapshot against the latest cloud revision. */
export async function keepLocalConflict(
  conflictId: string,
  latestRevision: number,
): Promise<void> {
  if (!Number.isInteger(latestRevision) || latestRevision < 0) {
    throw new Error("latestRevision must be a non-negative integer.");
  }
  const client = getClient();
  const tx = await client.transaction("write");
  try {
    const result = await tx.execute({
      sql: "select * from sync_conflicts where id = ? limit 1",
      args: [conflictId],
    });
    const row = result.rows[0];
    if (!row) throw new Error("Conflict not found.");
    const entityType = assertEntityType(String(row.entity_type));
    const entityId = String(row.entity_id);
    const localDeleted = Number(row.local_deleted) === 1;
    const localData = parseJsonObject(row.local_data);
    const localUpdatedAt = Number(row.local_updated_at);

    await tx.execute({
      sql: "delete from sync_changes where entity_type = ? and entity_id = ?",
      args: [entityType, entityId],
    });
    await tx.execute({
      sql: `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
            values (?, ?, ?, ?, ?)`,
      args: [
        entityType,
        entityId,
        localDeleted ? 1 : 0,
        stringifyJson(localData),
        localUpdatedAt,
      ],
    });
    await tx.execute({
      sql: `insert into sync_entity_revisions (entity_type, entity_id, revision)
            values (?, ?, ?)
            on conflict(entity_type, entity_id) do update set revision = excluded.revision`,
      args: [entityType, entityId, latestRevision],
    });
    await tx.execute({
      sql: "delete from sync_conflicts where id = ?",
      args: [conflictId],
    });
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}

/** Store the revision a pulled change was observed at. */
async function storeEntityRevision(
  tx: Transaction,
  change: RemoteSyncChange,
): Promise<void> {
  if (typeof change.revision !== "number" || !Number.isFinite(change.revision)) {
    return;
  }
  await tx.execute({
    sql: `insert into sync_entity_revisions (entity_type, entity_id, revision)
          values (?, ?, ?)
          on conflict(entity_type, entity_id) do update set revision = excluded.revision`,
    args: [change.entityType, change.entityId, Math.trunc(change.revision)],
  });
}

/** The entity no longer exists on the server, so a recreation is a creation. */
async function deleteEntityRevision(
  tx: Transaction,
  change: RemoteSyncChange,
): Promise<void> {
  await tx.execute({
    sql: "delete from sync_entity_revisions where entity_type = ? and entity_id = ?",
    args: [change.entityType, change.entityId],
  });
}

async function hasUnresolvedConflict(
  tx: Transaction,
  entityType: SyncEntityType,
  entityId: string,
): Promise<boolean> {
  const result = await tx.execute({
    sql: "select 1 as found from sync_conflicts where entity_type = ? and entity_id = ? limit 1",
    args: [entityType, entityId],
  });
  return result.rows.length > 0;
}

/**
 * Depth of each folder upsert in the incoming batch. Folders sort parent-first
 * so a child never arrives before the self-referencing FK target. A parent that
 * is not part of the batch is assumed to already exist, so it contributes no
 * extra depth. Cyclic data is treated as a root rather than recursing forever.
 */
function folderUpsertDepths(
  changes: RemoteSyncChange[],
): Map<string, number> {
  const parents = new Map<string, string | null>();
  for (const change of changes) {
    if (change.entityType !== "folder" || change.deleted) continue;
    const parentId = change.data.parent_id;
    parents.set(
      change.entityId,
      typeof parentId === "string" ? parentId : null,
    );
  }

  const depths = new Map<string, number>();
  const visit = (id: string, trail: Set<string>): number => {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    if (trail.has(id)) return 0;
    trail.add(id);
    const parentId = parents.get(id);
    const depth =
      parentId && parents.has(parentId) ? 1 + visit(parentId, trail) : 0;
    depths.set(id, depth);
    return depth;
  };
  for (const id of parents.keys()) visit(id, new Set());
  return depths;
}

function dependencyRank(type: SyncEntityType): number {
  switch (type) {
    case "project":
      return 0;
    case "folder":
      return 1;
    case "board":
      return 2;
    case "column":
      return 3;
    case "label":
      return 4;
    case "task":
      return 5;
    case "task_image":
      return 6;
    case "task_label":
      return 7;
    case "subtask":
      return 8;
    case "comment":
      return 9;
    case "whiteboard":
      return 10;
    case "note":
      return 11;
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
    project: "select updated_at as value from projects where id = ?",
    folder: "select updated_at as value from folders where id = ?",
    board: "select updated_at as value from boards where id = ?",
    column: "select updated_at as value from columns where id = ?",
    task: "select updated_at as value from tasks where id = ?",
    label: "select coalesce(updated_at, created_at) as value from labels where id = ?",
    subtask: "select coalesce(updated_at, created_at) as value from subtasks where id = ?",
    comment: "select coalesce(updated_at, created_at) as value from comments where id = ?",
    whiteboard: "select updated_at as value from whiteboards where board_id = ?",
    note: "select updated_at as value from notes where board_id = ?",
    task_image: "select updated_at as value from task_images where id = ?",
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

  // An unsynced local edit on an entity that has already round-tripped the
  // cloud (its outbox row joins a non-null base revision) is always newer than
  // the pull cursor and must win locally. Clock comparison is not reliable
  // across devices; the follow-up push resolves causality with the base
  // revision recorded from the push response or from this pull.
  // Bootstrap rows carry a null base revision, so a fresh mirror's first pull
  // is unaffected and still fills the local database.
  const pendingBase = await tx.execute({
    sql: `select r.revision as base_revision
          from sync_changes c
          left join sync_entity_revisions r
            on r.entity_type = c.entity_type and r.entity_id = c.entity_id
          where c.entity_type = ? and c.entity_id = ?
          order by c.id desc limit 1`,
    args: [change.entityType, change.entityId],
  });
  const baseRevision = pendingBase.rows[0]?.base_revision;
  if (baseRevision !== null && baseRevision !== undefined) {
    return true;
  }

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
    project: `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
      select 'project', id, 0,
        json_object('id', id, 'owner_id', owner_id, 'name', name, 'description', description,
                    'position', position, 'archived', archived, 'archived_at', archived_at,
                    'created_at', created_at, 'updated_at', updated_at),
        coalesce(updated_at, unixepoch() * 1000)
      from projects where id = ?`,
    folder: `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
      select 'folder', id, 0,
        json_object('id', id, 'owner_id', owner_id, 'project_id', project_id,
                    'parent_id', parent_id, 'name', name, 'position', position,
                    'created_at', created_at, 'updated_at', updated_at),
        coalesce(updated_at, unixepoch() * 1000)
      from folders where id = ?`,
    board: `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
      select 'board', id, 0,
        json_object('id', id, 'owner_id', owner_id, 'project_id', project_id,
                    'folder_id', folder_id, 'type', type,
                    'name', name, 'description', description,
                    'position', position, 'created_at', created_at, 'updated_at', updated_at),
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
                    'description', description, 'priority', priority, 'complexity', complexity,
                    'due_date', due_date, 'assignee', assignee, 'position', position,
                    'completed_at', completed_at, 'created_at', created_at, 'updated_at', updated_at),
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
    whiteboard: `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
      select 'whiteboard', board_id, 0,
        json_object('id', board_id, 'board_id', board_id, 'scene', scene, 'updated_at', updated_at),
        coalesce(updated_at, unixepoch() * 1000)
      from whiteboards where board_id = ?`,
    note: `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
      select 'note', board_id, 0,
        json_object('id', board_id, 'board_id', board_id, 'document', document, 'updated_at', updated_at),
        coalesce(updated_at, unixepoch() * 1000)
      from notes where board_id = ?`,
    task_image: `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
      select 'task_image', id, 0,
        json_object('id', id, 'task_id', task_id, 'url', url, 'name', name,
                    'position', position, 'created_at', created_at, 'updated_at', updated_at),
        coalesce(updated_at, created_at, unixepoch() * 1000)
      from task_images where id = ?`,
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

/**
 * Return a project for a board that arrived without one. A fresh mirror can
 * pull legacy cloud boards before any project entity exists; those boards must
 * still appear in the sidebar. The deterministic id makes every device
 * converge on the same default project.
 */
async function defaultProjectForTx(tx: Transaction): Promise<string> {
  const existing = await tx.execute(
    `select id from projects
     where owner_id = 'local-user' and archived = 0
     order by position, created_at limit 1`,
  );
  const activeId = existing.rows[0]?.id;
  if (typeof activeId === "string") return activeId;

  const deterministicId = "default-project-local-user";
  if (await exists(tx, "projects", deterministicId)) return deterministicId;

  const now = nowMs();
  const positionResult = await tx.execute(
    "select coalesce(max(position), -1) + 1 as position from projects",
  );
  const position = Number(positionResult.rows[0]?.position ?? 0);
  await tx.execute({
    sql: `insert into projects
          (id, owner_id, name, description, position, archived, archived_at, created_at, updated_at)
          values (?, 'local-user', 'General', null, ?, 0, null, ?, ?)`,
    args: [deterministicId, position, now, now],
  });
  // Remote apply suppresses table triggers. Queue the new project explicitly
  // so it exists in the cloud workspace as well.
  await tx.execute({
    sql: `insert into sync_changes (entity_type, entity_id, deleted, data, updated_at)
          select 'project', id, 0,
            json_object('id', id, 'owner_id', owner_id, 'name', name, 'description', description,
                        'position', position, 'archived', archived, 'archived_at', archived_at,
                        'created_at', created_at, 'updated_at', updated_at),
            updated_at
          from projects where id = ?`,
    args: [deterministicId],
  });
  return deterministicId;
}

async function deleteEntity(tx: Transaction, change: RemoteSyncChange): Promise<void> {
  switch (change.entityType) {
    case "project": {
      await tx.execute({ sql: "delete from projects where id = ?", args: [change.entityId] });
      const orphaned = await tx.execute(
        "select 1 as found from boards where owner_id = 'local-user' and project_id is null limit 1",
      );
      if (orphaned.rows.length > 0) {
        const projectId = await defaultProjectForTx(tx);
        await tx.execute({
          sql: "update boards set project_id = ? where owner_id = 'local-user' and project_id is null",
          args: [projectId],
        });
      }
      break;
    }
    case "folder": {
      // Match server deletion semantics: promote direct children to the
      // deleted folder's parent before removing it.
      const result = await tx.execute({
        sql: "select parent_id from folders where id = ? limit 1",
        args: [change.entityId],
      });
      const parentId =
        typeof result.rows[0]?.parent_id === "string"
          ? result.rows[0].parent_id
          : null;
      await tx.execute({
        sql: "update boards set folder_id = ? where folder_id = ?",
        args: [parentId, change.entityId],
      });
      await tx.execute({
        sql: "update folders set parent_id = ? where parent_id = ?",
        args: [parentId, change.entityId],
      });
      await tx.execute({
        sql: "delete from folders where id = ?",
        args: [change.entityId],
      });
      break;
    }
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
    case "whiteboard":
      await tx.execute({
        sql: "delete from whiteboards where board_id = ?",
        args: [change.entityId],
      });
      break;
    case "note":
      await tx.execute({
        sql: "delete from notes where board_id = ?",
        args: [change.entityId],
      });
      break;
    case "task_image":
      await tx.execute({
        sql: "delete from task_images where id = ?",
        args: [change.entityId],
      });
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
    case "project": {
      await tx.execute({
        sql: `insert into projects (id, owner_id, name, description, position, archived, archived_at, created_at, updated_at)
              values (?, 'local-user', ?, ?, ?, ?, ?, ?, ?)
              on conflict(id) do update set
                owner_id = 'local-user', name = excluded.name, description = excluded.description,
                position = excluded.position,
                archived = excluded.archived, archived_at = excluded.archived_at,
                updated_at = excluded.updated_at`,
        args: [
          change.entityId,
          asString(data.name, "Untitled project"),
          asNullableString(data.description),
          asNumber(data.position),
          asBoolean(data.archived) ? 1 : 0,
          data.archived_at === null || data.archived_at === undefined
            ? null
            : toMs(data.archived_at, now),
          toMs(data.created_at, now),
          toMs(data.updated_at, now),
        ],
      });
      return null;
    }
    case "folder": {
      // A folder can arrive before its project or parent in an unusual pull.
      // Keep it visible by falling back to the default project/root rather
      // than dropping the row.
      const projectId = asNullableString(data.project_id);
      const resolvedProjectId =
        projectId && (await exists(tx, "projects", projectId))
          ? projectId
          : await defaultProjectForTx(tx);
      let parentId = asNullableString(data.parent_id);
      if (parentId) {
        const parent = await tx.execute({
          sql: "select project_id from folders where id = ? limit 1",
          args: [parentId],
        });
        if (parent.rows[0]?.project_id !== resolvedProjectId) parentId = null;
      }
      await tx.execute({
        sql: `insert into folders (id, owner_id, project_id, parent_id, name, position, created_at, updated_at)
              values (?, 'local-user', ?, ?, ?, ?, ?, ?)
              on conflict(id) do update set
                owner_id = 'local-user', project_id = excluded.project_id,
                parent_id = excluded.parent_id, name = excluded.name,
                position = excluded.position, updated_at = excluded.updated_at`,
        args: [
          change.entityId,
          resolvedProjectId,
          parentId,
          asString(data.name, "Untitled folder"),
          asNumber(data.position),
          toMs(data.created_at, now),
          toMs(data.updated_at, now),
        ],
      });
      return null;
    }
    case "board": {
      // Legacy cloud rows have no project, and an out-of-order parent can be
      // missing. Assign the board to the default project instead of leaving it
      // invisible in the hierarchy.
      const projectId = asNullableString(data.project_id);
      const resolvedProjectId =
        projectId && (await exists(tx, "projects", projectId))
          ? projectId
          : await defaultProjectForTx(tx);
      let folderId = asNullableString(data.folder_id);
      if (folderId) {
        const folder = await tx.execute({
          sql: "select project_id from folders where id = ? limit 1",
          args: [folderId],
        });
        if (folder.rows[0]?.project_id !== resolvedProjectId) folderId = null;
      }
      await tx.execute({
        sql: `insert into boards (id, owner_id, project_id, folder_id, type, name, description, position, created_at, updated_at)
              values (?, 'local-user', ?, ?, ?, ?, ?, ?, ?, ?)
              on conflict(id) do update set
                owner_id = 'local-user', project_id = excluded.project_id,
                folder_id = excluded.folder_id, type = excluded.type,
                name = excluded.name, description = excluded.description,
                position = excluded.position, updated_at = excluded.updated_at`,
        args: [
          change.entityId,
          resolvedProjectId,
          folderId,
          asString(data.type, "kanban"),
          asString(data.name, "Untitled space"),
          asNullableString(data.description),
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
        sql: `insert into tasks (id, board_id, column_id, title, description, priority, complexity, due_date, assignee, position, completed_at, created_at, updated_at)
              values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              on conflict(id) do update set
                board_id = excluded.board_id, column_id = excluded.column_id, title = excluded.title,
                description = excluded.description, priority = excluded.priority,
                complexity = excluded.complexity, due_date = excluded.due_date,
                assignee = excluded.assignee, position = excluded.position,
                completed_at = excluded.completed_at, updated_at = excluded.updated_at`,
        args: [
          change.entityId,
          boardId,
          columnId,
          asString(data.title, "Untitled task"),
          asNullableString(data.description),
          asString(data.priority, "none"),
          asNullableString(data.complexity),
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
    case "whiteboard": {
      const boardId = asString(data.board_id, change.entityId);
      if (!(await exists(tx, "boards", boardId))) return "Parent board no longer exists";
      await tx.execute({
        sql: `insert into whiteboards (board_id, scene, updated_at)
              values (?, ?, ?)
              on conflict(board_id) do update set
                scene = excluded.scene, updated_at = excluded.updated_at`,
        args: [
          boardId,
          asString(data.scene, "{}"),
          toMs(data.updated_at, now),
        ],
      });
      return null;
    }
    case "note": {
      const boardId = asString(data.board_id, change.entityId);
      if (!(await exists(tx, "boards", boardId))) return "Parent board no longer exists";
      await tx.execute({
        sql: `insert into notes (board_id, document, updated_at)
              values (?, ?, ?)
              on conflict(board_id) do update set
                document = excluded.document, updated_at = excluded.updated_at`,
        args: [
          boardId,
          asString(data.document, "[]"),
          toMs(data.updated_at, now),
        ],
      });
      return null;
    }
    case "task_image": {
      const taskId = asString(data.task_id);
      if (!(await exists(tx, "tasks", taskId))) return "Parent task no longer exists";
      await tx.execute({
        sql: `insert into task_images (id, task_id, url, name, position, created_at, updated_at)
              values (?, ?, ?, ?, ?, ?, ?)
              on conflict(id) do update set
                task_id = excluded.task_id, url = excluded.url, name = excluded.name,
                position = excluded.position, updated_at = excluded.updated_at`,
        args: [
          change.entityId,
          taskId,
          asString(data.url, ""),
          asNullableString(data.name),
          asNumber(data.position),
          toMs(data.created_at, now),
          toMs(data.updated_at, now),
        ],
      });
      return null;
    }
  }
}

