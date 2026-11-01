import { serve } from "@hono/node-server";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createLocalApp } from "@/server/app";
import { boards } from "@/db/schema";
import { getClient, getDatabaseBundle, getDb } from "@/db";
import { SyncEngine } from "../desktop/src/premium/sync-engine";
import type { PremiumApiClient } from "../desktop/src/premium/client";
import type { SyncStatus } from "@/lib/premium-types";
import {
  createBoard,
  getBoardDetail,
  updateBoard,
} from "@/lib/server/boards";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";

/**
 * End-to-end sync lifecycle across two simulated machines. The real
 * SyncEngine, the real local API routes and the real SQLite sync machinery run
 * against an in-memory stand-in for the Premium Sync API.
 */

const USER_A = { id: "user-a", name: "Alice", email: "alice@example.test" };
const USER_B = { id: "user-b", name: "Bob", email: "bob@example.test" };

interface RemoteRow {
  entityType: string;
  entityId: string;
  deleted: boolean;
  data: Record<string, unknown>;
  updatedAt: string;
  revision: number;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

/** Minimal per-user replica of the Premium Sync API sync semantics. */
class FakeSyncApi {
  readonly workspaces = new Map<string, Map<string, RemoteRow>>();
  private revisions = new Map<string, number>();
  readonly conflicts: Array<{
    userId: string;
    entityType: string;
    entityId: string;
    incomingData: Record<string, unknown>;
    winningRevision: number;
  }> = [];

  private rowsFor(userId: string): Map<string, RemoteRow> {
    let rows = this.workspaces.get(userId);
    if (!rows) {
      rows = new Map();
      this.workspaces.set(userId, rows);
    }
    return rows;
  }

  async push(
    userId: string,
    changes: Array<{
      entityType: string;
      entityId: string;
      deleted: boolean;
      data: Record<string, unknown>;
      updatedAt: string;
      baseRevision: number | null;
    }>,
  ) {
    const rows = this.rowsFor(userId);
    let revision = this.revisions.get(userId) ?? 0;
    let accepted = 0;
    let ignored = 0;
    let rejected = 0;
    const conflicts: Array<{ entityType: string; entityId: string }> = [];
    for (const change of changes) {
      const key = `${change.entityType}:${change.entityId}`;
      const existing = rows.get(key);
      if (existing) {
        const same =
          existing.deleted === change.deleted &&
          stableJson(existing.data ?? {}) === stableJson(change.data ?? {});
        if (same) {
          ignored += 1;
          continue;
        }
        // Causal resolution: apply only sequential edits and legacy data;
        // client timestamps never participate.
        const applies =
          change.baseRevision === -1 ||
          change.baseRevision === existing.revision;
        if (!applies) {
          rejected += 1;
          conflicts.push({ entityType: change.entityType, entityId: change.entityId });
          this.conflicts.push({
            userId,
            entityType: change.entityType,
            entityId: change.entityId,
            incomingData: change.data,
            winningRevision: existing.revision,
          });
          continue;
        }
      }
      revision += 1;
      const stamped =
        change.data && !change.deleted && "updated_at" in change.data
          ? { ...change.data, updated_at: Date.now() }
          : change.data;
      rows.set(key, {
        ...change,
        data: stamped ?? {},
        updatedAt: new Date().toISOString(),
        revision,
      });
      accepted += 1;
    }
    this.revisions.set(userId, revision);
    return { revision, accepted, ignored, rejected, conflicts };
  }

  async pull(userId: string, since: number, limit = 500) {
    const revision = this.revisions.get(userId) ?? 0;
    const rows = [...this.rowsFor(userId).values()]
      .filter((row) => row.revision > since)
      .sort((a, b) => a.revision - b.revision);
    const page = rows.slice(0, limit);
    return {
      workspaceRevision: revision,
      nextRevision: page.length > 0 ? page[page.length - 1]!.revision : since,
      hasMore: rows.length > limit,
      changes: page,
    };
  }

  entityCount(userId: string): number {
    return this.rowsFor(userId).size;
  }
}

const remote = new FakeSyncApi();

function clientFor(user: typeof USER_A) {
  return {
    async me() {
      return { user };
    },
    async entitlement() {
      return {
        entitlement: {
          entitled: true,
          reason: "active" as const,
          status: "active",
          currentPeriodEnd: null,
          trialEnd: null,
          cancelAtPeriodEnd: false,
        },
        subscription: null,
        billingConfigured: false,
      };
    },
    async pushChanges(
      changes: Array<{
        entityType: string;
        entityId: string;
        deleted: boolean;
        data: Record<string, unknown>;
        updatedAt: string;
        baseRevision: number | null;
      }>,
    ) {
      return remote.push(user.id, changes);
    },
    async pullChanges(since: number, limit?: number) {
      return remote.pull(user.id, since, limit ?? 500);
    },
  };
}

/** The routes read the database through a process-global handle. */
async function activateDatabase(url: string): Promise<void> {
  const previous = getDatabaseBundle().client;
  (globalThis as unknown as { __masarDatabase?: unknown }).__masarDatabase =
    undefined;
  process.env.DATABASE_URL = url;
  try {
    previous.close();
  } catch {
    /* already closed */
  }
}

function startLocalApi(scope: string): Promise<{ url: string; close(): void }> {
  // The routes read the scope from the process environment per request, just
  // like the forked server process does in the packaged app.
  process.env.MASAR_SYNC_SCOPE = scope;
  const app = createLocalApp();
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      resolve({
        url: `http://127.0.0.1:${info.port}`,
        close: () => {
          server.close();
          delete process.env.MASAR_SYNC_SCOPE;
        },
      });
    });
    server.on("error", reject);
  });
}

function makeEngine(origin: string, userId: string): SyncEngine {
  const fakeClient = clientFor(userId === USER_A.id ? USER_A : USER_B);
  return new SyncEngine({
    getClient: () => fakeClient as unknown as PremiumApiClient,
    getLocalOrigin: () => origin,
    isOnline: () => true,
    log: () => undefined,
    onStatus: () => undefined,
    onUnauthorized: () => undefined,
  });
}

const LOCAL_USER_STUB = `INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
  VALUES ('local-user', 'Local workspace', 'local@masar.app', 1, 1700000000000, 1700000000000)`;

let mirrorA: TestDatabase;
let mirrorB: TestDatabase;
let mirrorC: TestDatabase;
let localA: TestDatabase;
let localB: TestDatabase;

beforeAll(async () => {
  mirrorA = await createTestDatabase();
  mirrorB = await createTestDatabase();
  mirrorC = await createTestDatabase();
  localA = await createTestDatabase();
  localB = await createTestDatabase();
  for (const db of [mirrorA, mirrorB, mirrorC, localA, localB]) {
    await db.client.execute(LOCAL_USER_STUB);
  }
});

afterAll(async () => {
  for (const db of [mirrorA, mirrorB, mirrorC, localA, localB]) {
    await db.close();
  }
});

async function boardNames(db: TestDatabase): Promise<string[]> {
  const rows = await db.db.select().from(boards).orderBy(boards.position);
  return rows.map((row) => row.name);
}

describe("cross-device premium sync lifecycle", () => {
  it("syncs a new account's work to a second machine with its own local workspace", async () => {
    // ── Machine A: fresh mirror, first sign-in pulls nothing ──────────────
    await activateDatabase(mirrorA.url);
    const apiA = await startLocalApi(USER_A.id);
    try {
      const engineA = makeEngine(apiA.url, USER_A.id);
      await engineA.syncNow("startup");

      // User creates a board while signed in.
      await createBoard({ name: "Roadmap" }, "local-user", getDb());
      await engineA.syncNow("local-change");
      expect(await boardNames(mirrorA)).toEqual(["Roadmap"]);
      expect(remote.entityCount(USER_A.id)).toBeGreaterThan(0);
    } finally {
      apiA.close();
    }

    // ── Machine B: has its own local workspace data ───────────────────────
    await activateDatabase(localB.url);
    await createBoard({ name: "Private local board" }, "local-user", getDb());

    // Signing in must NOT upload the local workspace.
    await activateDatabase(mirrorB.url);
    const apiB = await startLocalApi(USER_A.id);
    try {
      const engineB = makeEngine(apiB.url, USER_A.id);
      await engineB.syncNow("startup");

      // The complete cloud workspace was retrieved.
      expect(await boardNames(mirrorB)).toEqual(["Roadmap"]);

      // The remote workspace contains only the cloud board, not B's local one.
      const remoteBoards = [...remote.workspaces.get(USER_A.id)!.values()]
        .filter((row) => row.entityType === "board" && !row.deleted)
        .map((row) => (row.data.name as string | undefined) ?? "");
      expect(remoteBoards).toEqual(["Roadmap"]);

      // ── Edit on machine B syncs back to machine A ──────────────────────
      const [roadmap] = await getDb().select().from(boards);
      expect(roadmap?.name).toBe("Roadmap");
      await updateBoard(roadmap!.id, { name: "Roadmap 2026" }, "local-user", getDb());
      await engineB.syncNow("local-change");
    } finally {
      apiB.close();
    }

    await activateDatabase(mirrorA.url);
    const apiA2 = await startLocalApi(USER_A.id);
    try {
      const engineA = makeEngine(apiA2.url, USER_A.id);
      await engineA.syncNow("startup");
      expect(await boardNames(mirrorA)).toEqual(["Roadmap 2026"]);
    } finally {
      apiA2.close();
    }

    // B's local workspace is untouched by all of the above.
    await activateDatabase(localB.url);
    expect(await boardNames(localB)).toEqual(["Private local board"]);
  });

  it("keeps different accounts' cloud workspaces isolated on the same machine", async () => {
    await activateDatabase(mirrorC.url);
    const apiC = await startLocalApi(USER_B.id);
    try {
      const engineC = makeEngine(apiC.url, USER_B.id);
      await engineC.syncNow("startup");

      // Bob's fresh workspace starts empty even though Alice's exists on this
      // machine's other mirrors.
      expect(await boardNames(mirrorC)).toEqual([]);
      expect(remote.entityCount(USER_B.id)).toBe(0);
    } finally {
      apiC.close();
    }

    // Alice's cloud workspace is unchanged.
    const aliceBoards = [...remote.workspaces.get(USER_A.id)!.values()]
      .filter((row) => row.entityType === "board" && !row.deleted)
      .map((row) => row.data.name);
    expect(aliceBoards).toEqual(["Roadmap 2026"]);
  });

  it("imports the local workspace explicitly and idempotently", async () => {
    // Machine B's local workspace becomes Alice's cloud content only through
    // the explicit import action.
    await activateDatabase(localB.url);
    const [localBoard] = await getDb().select().from(boards);
    expect(localBoard?.name).toBe("Private local board");
    const detail = await getBoardDetail(localBoard!.id, "local-user", getDb());

    await activateDatabase(mirrorB.url);
    process.env.MASAR_LOCAL_DB_URL = localB.url;
    const apiB = await startLocalApi(USER_A.id);
    try {
      const engineB = makeEngine(apiB.url, USER_A.id);
      await engineB.syncNow("startup");

      const response = await fetch(`${apiB.url}/api/sync/import-local`, {
        method: "POST",
      });
      expect(response.status).toBe(201);
      await engineB.syncNow("import");

      // Re-importing is a no-op.
      const again = await fetch(`${apiB.url}/api/sync/import-local`, {
        method: "POST",
      });
      expect(again.status).toBe(201);
      await engineB.syncNow("import");

      expect((await boardNames(mirrorB)).sort()).toEqual(
        ["Private local board", "Roadmap 2026"].sort(),
      );
    } finally {
      delete process.env.MASAR_LOCAL_DB_URL;
      apiB.close();
    }

    // The local workspace still owns its board; import only copies.
    await activateDatabase(localB.url);
    const [row] = await getDb().select().from(boards).where(eq(boards.id, localBoard!.id));
    expect(row?.name).toBe("Private local board");
    expect((await getBoardDetail(localBoard!.id, "local-user", getDb())).tasks).toEqual(
      detail.tasks,
    );
  });

  it("resolves concurrent edits by revision, never by skewed client clocks", async () => {
    // Machine A creates the board and syncs it.
    await activateDatabase(mirrorA.url);
    const apiA = await startLocalApi(USER_A.id);
    try {
      const engineA = makeEngine(apiA.url, USER_A.id);
      await engineA.syncNow("startup");
      await createBoard({ name: "Skew test" }, "local-user", getDb());
      await engineA.syncNow("local-change");
    } finally {
      apiA.close();
    }

    // Machine B pulls it.
    await activateDatabase(mirrorB.url);
    const apiB = await startLocalApi(USER_A.id);
    try {
      const engineB = makeEngine(apiB.url, USER_A.id);
      await engineB.syncNow("startup");
      const boardsOnB = await getDb().select().from(boards);
      const board = boardsOnB.find((row) => row.name === "Skew test");
      expect(board).toBeDefined();

      // Both devices edit the same base revision concurrently.
      await updateBoard(board!.id, { name: "B edited later in real time" }, "local-user", getDb());
      await engineB.syncNow("local-change");
    } finally {
      apiB.close();
    }

    // Machine A edited "first" but its clock is days ahead of real time. The
    // skew must not let its stale edit overwrite B's newer one.
    await activateDatabase(mirrorA.url);
    const apiA2 = await startLocalApi(USER_A.id);
    try {
      const engineA = makeEngine(apiA2.url, USER_A.id);
      const boardsOnA = await getDb().select().from(boards);
      const board = boardsOnA.find((row) => row.name === "Skew test");
      expect(board).toBeDefined();
      await updateBoard(board!.id, { name: "A edited first, skewed clock" }, "local-user", getDb());
      const skewed = Date.now() + 10 * 24 * 60 * 60 * 1000;
      await getDb().update(boards).set({
        updatedAt: new Date(skewed),
      }).where(eq(boards.id, board!.id));
      await getClient().execute(
        "update sync_changes set updated_at = ?, data = json_set(data, '$.updated_at', ?) where entity_type = 'board' and entity_id = ?",
        [skewed, skewed, board!.id],
      );

      await engineA.syncNow("local-change");

      // The server kept B's version and rejected A's stale edit as a conflict,
      // despite A's future timestamps. A converges to the winner.
      const [row] = await getDb().select().from(boards).where(eq(boards.id, board!.id));
      expect(row?.name).toBe("B edited later in real time");

      const remoteBoards = [...remote.workspaces.get(USER_A.id)!.values()]
        .filter((entry) => entry.entityType === "board" && !entry.deleted);
      const winner = remoteBoards.find((entry) => entry.entityId === board!.id);
      expect(winner?.data.name).toBe("B edited later in real time");
      expect(
        remote.conflicts.filter(
          (conflict) =>
            conflict.userId === USER_A.id &&
            conflict.entityType === "board" &&
            conflict.entityId === board!.id,
        ),
      ).toHaveLength(1);
    } finally {
      apiA2.close();
    }
  });

  it("reports sync status that ends in idle without pending changes", async () => {
    await activateDatabase(mirrorA.url);
    const apiA = await startLocalApi(USER_A.id);
    const statuses: SyncStatus[] = [];
    const fakeClient = clientFor(USER_A);
    const engine = new SyncEngine({
      getClient: () => fakeClient as unknown as PremiumApiClient,
      getLocalOrigin: () => apiA.url,
      isOnline: () => true,
      log: () => undefined,
      onStatus: (status) => statuses.push(status),
      onUnauthorized: () => undefined,
    });
    try {
      const final = await engine.syncNow("startup");
      expect(final.phase).toBe("idle");
      expect(final.pendingChanges).toBe(0);
    } finally {
      apiA.close();
    }
  });
});
