import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { handleRouteError, jsonOk } from "@/lib/api";
import { requireApiUser } from "@/lib/server/auth";
import { addDemoWorkspace } from "@/lib/server/demo";
import { getSyncState, listPendingChanges } from "@/sync/local";

export const workspaceRoutes = new Hono();

workspaceRoutes.get("/health", async () => {
  try {
    await getDb().run(sql`select 1`);
    return jsonOk({ status: "ok", database: "connected" });
  } catch (error) {
    return handleRouteError(error);
  }
});

workspaceRoutes.get("/me", async (_c) => {
  try {
    const user = await requireApiUser();
    const syncName = process.env.MASAR_SYNC_USER_NAME?.trim();
    const syncEmail = process.env.MASAR_SYNC_USER_EMAIL?.trim();
    if (syncName) {
      // The local API is serving a premium sync mirror: report the premium
      // account so the UI can distinguish the cloud workspace from local.
      return jsonOk({
        user: {
          id: user.id,
          name: syncName,
          email: syncEmail || "",
          premium: true,
        },
      });
    }
    return jsonOk({
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (error) {
    return handleRouteError(error);
  }
});

workspaceRoutes.post("/onboarding/demo", async (_c) => {
  try {
    const user = await requireApiUser();
    return jsonOk({ board: await addDemoWorkspace(user.id) }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
});

workspaceRoutes.get("/sync/state", async (_c) => {
  try {
    return jsonOk({ state: await getSyncState() });
  } catch (error) {
    return handleRouteError(error);
  }
});

workspaceRoutes.get("/sync/pending", async (c) => {
  try {
    const after = Number(c.req.query("after") ?? 0);
    const limit = Number(c.req.query("limit") ?? 200);
    if (!Number.isInteger(after) || after < 0) {
      return jsonOk({ error: "after must be a non-negative integer" }, 400);
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      return jsonOk({ error: "limit must be between 1 and 1000" }, 400);
    }
    return jsonOk({ changes: await listPendingChanges(after, limit) });
  } catch (error) {
    return handleRouteError(error);
  }
});
