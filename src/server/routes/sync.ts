import { Hono } from "hono";
import { z } from "zod";

import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { acknowledgeChanges, applyRemoteChanges, prepareSync } from "@/sync/local";

const ENTITY_TYPES = [
  "board",
  "column",
  "task",
  "label",
  "task_label",
  "subtask",
  "comment",
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
});

export const syncRoutes = new Hono();

syncRoutes.post("/sync/prepare", async (c) => {
  try {
    const input = await parseJsonBody(c.req.raw, prepareSchema);
    return jsonOk({
      state: await prepareSync(input.remoteUserId, input.resetCursor),
    });
  } catch (error) {
    return handleRouteError(error);
  }
});

syncRoutes.post("/sync/apply", async (c) => {
  try {
    const input = await parseJsonBody(c.req.raw, applySchema);
    return jsonOk(await applyRemoteChanges(input.nextRevision, input.changes));
  } catch (error) {
    return handleRouteError(error);
  }
});

syncRoutes.post("/sync/ack", async (c) => {
  try {
    const input = await parseJsonBody(c.req.raw, ackSchema);
    return jsonOk({ deleted: await acknowledgeChanges(input.throughId) });
  } catch (error) {
    return handleRouteError(error);
  }
});
