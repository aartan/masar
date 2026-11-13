import { Hono } from "hono";
import { z } from "zod";

import { ApiError, handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { getLocalUser } from "@/lib/server/desktop";
import { importLocalWorkspace } from "@/sync/import-local";
import {
  acknowledgeChanges,
  applyCloudConflict,
  applyRemoteChanges,
  getSyncState,
  keepLocalConflict,
  listSyncConflicts,
  prepareSync,
  recordSyncConflicts,
} from "@/sync/local";

const ENTITY_TYPES = [
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
] as const;

const remoteChangeSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().min(1).max(120),
  deleted: z.boolean(),
  data: z.record(z.string(), z.unknown()).default({}),
  updatedAt: z.string().datetime({ offset: true }),
  revision: z.number().int().nonnegative().optional(),
});

const applySchema = z.object({
  nextRevision: z.number().int().nonnegative(),
  changes: z.array(remoteChangeSchema).max(2000),
});

const prepareSchema = z.object({
  remoteUserId: z.string().min(1).max(120),
  resetCursor: z.boolean().optional().default(false),
});

const ackSchema = z.object({
  throughId: z.number().int().nonnegative(),
  accepted: z
    .array(
      z.object({
        entityType: z.enum(ENTITY_TYPES),
        entityId: z.string().min(1).max(120),
        revision: z.number().int().nonnegative(),
      }),
    )
    .max(2_000)
    .optional()
    .default([]),
});

const remoteConflictSchema = z.object({
  id: z.string().min(1).max(120),
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().min(1).max(120),
  incomingDeleted: z.boolean(),
  incomingData: z.record(z.string(), z.unknown()).default({}),
  incomingUpdatedAt: z.string().datetime({ offset: true }),
  winningDeleted: z.boolean(),
  winningData: z.record(z.string(), z.unknown()).default({}),
  winningUpdatedAt: z.string().datetime({ offset: true }),
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
});

const recordConflictsSchema = z.object({
  conflicts: z.array(remoteConflictSchema).max(2_000),
});

const latestEntitySchema = z.object({
  deleted: z.boolean(),
  data: z.record(z.string(), z.unknown()).default({}),
  updatedAt: z.string().datetime({ offset: true }),
  revision: z.number().int().nonnegative(),
});

const applyCloudConflictSchema = z.object({
  current: latestEntitySchema.nullable().optional(),
});

const keepLocalConflictSchema = z.object({
  revision: z.number().int().nonnegative(),
});

/**
 * The Electron main process starts the local API with `MASAR_SYNC_SCOPE` set to
 * the remote user id only when the process is serving that account's sync
 * mirror database. The ordinary local-workspace server never sets it, so sync
 * mutations can never touch local workspace data even if a stray request
 * arrives during a workspace switch.
 */
function requireSyncScope(): string {
  const scope = process.env.MASAR_SYNC_SCOPE?.trim();
  if (!scope) {
    throw new ApiError(
      "This workspace is not connected to premium sync.",
      409,
    );
  }
  return scope;
}

/**
 * Remote board upserts reference the implicit local account row, so the mirror
 * must have it before the first sync cycle applies anything — the renderer's
 * own requests normally create it, but the sync engine can run first.
 */
async function ensureSyncWorkspaceUser(): Promise<void> {
  await getLocalUser();
}

export const syncRoutes = new Hono();

syncRoutes.post("/sync/prepare", async (c) => {
  try {
    const input = await parseJsonBody(c.req.raw, prepareSchema);
    const scope = requireSyncScope();
    if (input.remoteUserId !== scope) {
      throw new ApiError(
        "This workspace belongs to a different premium account.",
        409,
      );
    }
    await ensureSyncWorkspaceUser();
    return jsonOk({
      state: await prepareSync(input.remoteUserId, input.resetCursor),
    });
  } catch (error) {
    return handleRouteError(error);
  }
});

syncRoutes.post("/sync/apply", async (c) => {
  try {
    requireSyncScope();
    await ensureSyncWorkspaceUser();
    const input = await parseJsonBody(c.req.raw, applySchema);
    return jsonOk(await applyRemoteChanges(input.nextRevision, input.changes));
  } catch (error) {
    return handleRouteError(error);
  }
});

syncRoutes.post("/sync/ack", async (c) => {
  try {
    requireSyncScope();
    const input = await parseJsonBody(c.req.raw, ackSchema);
    return jsonOk({
      deleted: await acknowledgeChanges(input.throughId, input.accepted),
    });
  } catch (error) {
    return handleRouteError(error);
  }
});

syncRoutes.get("/sync/conflicts", async (_c) => {
  try {
    requireSyncScope();
    return jsonOk({ conflicts: await listSyncConflicts() });
  } catch (error) {
    return handleRouteError(error);
  }
});

syncRoutes.post("/sync/conflicts/record", async (c) => {
  try {
    requireSyncScope();
    const input = await parseJsonBody(c.req.raw, recordConflictsSchema);
    return jsonOk({
      recorded: await recordSyncConflicts(input.conflicts),
    });
  } catch (error) {
    return handleRouteError(error);
  }
});

syncRoutes.post("/sync/conflicts/:conflictId/apply-cloud", async (c) => {
  try {
    requireSyncScope();
    const input = await parseJsonBody(c.req.raw, applyCloudConflictSchema);
    await applyCloudConflict(c.req.param("conflictId"), input.current ?? undefined);
    return jsonOk({ state: await getSyncState() });
  } catch (error) {
    return handleRouteError(error);
  }
});

syncRoutes.post("/sync/conflicts/:conflictId/keep-local", async (c) => {
  try {
    requireSyncScope();
    const input = await parseJsonBody(c.req.raw, keepLocalConflictSchema);
    await keepLocalConflict(c.req.param("conflictId"), input.revision);
    return jsonOk({ state: await getSyncState() });
  } catch (error) {
    return handleRouteError(error);
  }
});

/**
 * Explicit one-way copy of the local workspace into the currently connected
 * premium workspace. This replaces the pre-migration "Import local workspace"
 * menu action; unlike background sync it is always user-initiated.
 */
syncRoutes.post("/sync/import-local", async (_c) => {
  try {
    requireSyncScope();
    const localDatabaseUrl = process.env.MASAR_LOCAL_DB_URL?.trim();
    if (!localDatabaseUrl) {
      throw new ApiError("The local workspace is not available.", 409);
    }
    await ensureSyncWorkspaceUser();
    return jsonOk(await importLocalWorkspace(localDatabaseUrl), 201);
  } catch (error) {
    return handleRouteError(error);
  }
});
