import { serve } from "@hono/node-server";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createLocalApp } from "@/server/app";
import { boards, tasks } from "@/db/schema";
import { getClient, getDatabaseBundle, getDb } from "@/db";
import { SyncEngine } from "../desktop/src/premium/sync-engine";
import type { PremiumApiClient } from "../desktop/src/premium/client";
import type { SyncStatus } from "@/lib/premium-types";
import {
  createBoard,
  getBoardDetail,
  updateBoard,
} from "@/lib/server/boards";
import { createTask, updateTask } from "@/lib/server/tasks";
import { saveWhiteboardScene } from "@/lib/server/whiteboards";
import { keepLocalConflict, listSyncConflicts } from "@/sync/local";
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

/**
 * Deterministic JSON for the identical-retry check, mirroring the real
 * server's `stableStringify` in masar-api/src/sync/changes.ts.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

interface FakeConflict {
  id: string;
  entityType: string;
  entityId: string;
  clientId: string | null;
  incomingUpdatedAt: string;
  winningUpdatedAt: string;
  incomingDeleted: boolean;
  winningDeleted: boolean;
  incomingData: Record<string, unknown>;
  winningData: Record<string, unknown>;
  revision: number;
  createdAt: string;
  resolvedAt: string | null;
  resolution: "cloud" | "local" | null;
}

/** Minimal per-user replica of the Premium Sync API sync semantics. */
class FakeSyncApi {
  readonly workspaces = new Map<string, Map<string, RemoteRow>>();
  private revisions = new Map<string, number>();
  private conflictRows = new Map<string, Map<string, FakeConflict>>();
  private conflictSeq = 0;
  /** When set, the next pull throws, simulating a network failure. */
  failNextPull = false;

  private rowsFor(userId: string): Map<string, RemoteRow> {
    let rows = this.workspaces.get(userId);
    if (!rows) {
      rows = new Map();
      this.workspaces.set(userId, rows);
    }
    return rows;
  }

  private conflictsFor(userId: string): Map<string, FakeConflict> {
    let rows = this.conflictRows.get(userId);
    if (!rows) {
      rows = new Map();
      this.conflictRows.set(userId, rows);
    }
    return rows;
  }

  async getConflict(userId: string, id: string) {
    const conflict = this.conflictsFor(userId).get(id);
    if (!conflict) throw new Error("Conflict not found.");
    const current = this.rowsFor(userId).get(
      `${conflict.entityType}:${conflict.entityId}`,
    );
    return {
      conflict,
      current: current ?? null,
    };
  }

  async resolveConflict(
    userId: string,
    id: string,
    resolution: "cloud" | "local",
  ) {
    const conflict = this.conflictsFor(userId).get(id);
    if (!conflict) throw new Error("Conflict not found.");
    conflict.resolvedAt = new Date().toISOString();
    conflict.resolution = resolution;
    const current = this.rowsFor(userId).get(
      `${conflict.entityType}:${conflict.entityId}`,
    );
    return { conflict, current: current ?? null };
  }

  /** Simulate a change pushed by another device. */
  simulateRemoteEdit(
    userId: string,
    entityType: string,
    entityId: string,
    data: Record<string, unknown>,
  ): RemoteRow {
    const revision = (this.revisions.get(userId) ?? 0) + 1;
    this.revisions.set(userId, revision);
    const row: RemoteRow = {
      entityType,
      entityId,
      deleted: false,
      data,
      updatedAt: new Date().toISOString(),
      revision,
    };
    this.rowsFor(userId).set(`${entityType}:${entityId}`, row);
    return row;
  }

  async push(
    userId: string,
    changes: Array<{
      entityType: string;
      entityId: string;
      deleted: boolean;
      data: Record<string, unknown>;
      updatedAt: string;
      baseRevision?: number | null;
    }>,
  ) {
    const rows = this.rowsFor(userId);
    let revision = this.revisions.get(userId) ?? 0;
    let accepted = 0;
    let ignored = 0;
    let rejected = 0;
    const acceptedChanges: Array<{
      entityType: string;
      entityId: string;
      revision: number;
    }> = [];
    const conflicts: Array<{
      id: string;
      entityType: string;
      entityId: string;
      winningUpdatedAt: string;
    }> = [];
    for (const change of changes) {
      const key = `${change.entityType}:${change.entityId}`;
      const existing = rows.get(key);

      // Faithful reproduction of masar-api decideChange: causality is proven
      // only by baseRevision, never by comparing timestamps. Omitting
      // baseRevision on an existing entity is a conflict — this is what makes
      // the e2e suite actually catch the revision bug. Whiteboards are the
      // exception: whole-scene snapshots converge last-write-wins.
      let decision: "apply" | "ignore" | "conflict";
      if (!existing) {
        decision = "apply";
      } else if (
        existing.deleted === change.deleted &&
        stableStringify(existing.data ?? {}) === stableStringify(change.data ?? {})
      ) {
        decision = "ignore";
      } else if (change.entityType === "whiteboard") {
        decision = "apply";
      } else {
        const base = change.baseRevision;
        if (base === null || base === undefined) decision = "conflict";
        else if (base === -1) decision = "apply";
        else if (base === existing.revision) decision = "apply";
        else decision = "conflict";
      }

      if (decision === "ignore") {
        ignored += 1;
        continue;
      }
      if (decision === "conflict") {
        rejected += 1;
        const conflictKey = `${change.entityType}:${change.entityId}`;
        const existingConflict = [...this.conflictsFor(userId).values()].find(
          (row) =>
            !row.resolvedAt &&
            `${row.entityType}:${row.entityId}` === conflictKey,
        );
        const conflict: FakeConflict = existingConflict ?? {
          id: `conflict-${++this.conflictSeq}`,
          entityType: change.entityType,
          entityId: change.entityId,
          clientId: null,
          incomingUpdatedAt: change.updatedAt,
          winningUpdatedAt: existing?.updatedAt ?? change.updatedAt,
          incomingDeleted: change.deleted,
          winningDeleted: existing?.deleted ?? false,
          incomingData: change.data ?? {},
          winningData: existing?.data ?? {},
          revision: existing?.revision ?? 0,
          createdAt: new Date().toISOString(),
          resolvedAt: null,
          resolution: null,
        };
        conflict.incomingUpdatedAt = change.updatedAt;
        conflict.incomingDeleted = change.deleted;
        conflict.incomingData = change.data ?? {};
        conflict.winningUpdatedAt = existing?.updatedAt ?? change.updatedAt;
        conflict.winningDeleted = existing?.deleted ?? false;
        conflict.winningData = existing?.data ?? {};
        conflict.revision = existing?.revision ?? 0;
        this.conflictsFor(userId).set(conflict.id, conflict);
        conflicts.push({
          id: conflict.id,
          entityType: change.entityType,
          entityId: change.entityId,
          winningUpdatedAt: conflict.winningUpdatedAt,
        });
        continue;
      }
      revision += 1;
      rows.set(key, {
        entityType: change.entityType,
        entityId: change.entityId,
        deleted: change.deleted,
        data: change.data,
        updatedAt: change.updatedAt,
        revision,
      });
      accepted += 1;
      acceptedChanges.push({
        entityType: change.entityType,
        entityId: change.entityId,
        revision,
      });
    }
    this.revisions.set(userId, revision);
    return { revision, accepted, ignored, rejected, acceptedChanges, conflicts };
  }

  async pull(userId: string, since: number, limit = 500) {
    if (this.failNextPull) {
      this.failNextPull = false;
      throw new Error("simulated pull failure");
    }
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

  entity(
    userId: string,
    entityType: string,
    entityId: string,
  ): RemoteRow | undefined {
    return this.rowsFor(userId).get(`${entityType}:${entityId}`);
  }

  conflictCount(userId: string): number {
    return [...this.conflictsFor(userId).values()].filter(
      (row) => !row.resolvedAt,
    ).length;
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
        baseRevision?: number | null;
      }>,
    ) {
      return remote.push(user.id, changes);
    },
    async pullChanges(since: number, limit?: number) {
      return remote.pull(user.id, since, limit ?? 500);
    },
    async conflict(id: string) {
      return remote.getConflict(user.id, id);
    },
    async resolveConflict(id: string, resolution: "cloud" | "local") {
      return remote.resolveConflict(user.id, id, resolution);
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

  it("re-syncs repeated edits to the same entity without dropping any (revision regression)", async () => {
    const userId = "user-rev";
    const user = { id: userId, name: "Rev", email: "rev@example.test" };
    const mirror = await createTestDatabase();
    await mirror.client.execute(LOCAL_USER_STUB);
    await activateDatabase(mirror.url);

    const fakeClient = clientFor(user);
    const makeRevEngine = (origin: string) =>
      new SyncEngine({
        getClient: () => fakeClient as unknown as PremiumApiClient,
        getLocalOrigin: () => origin,
        isOnline: () => true,
        log: () => undefined,
        onStatus: () => undefined,
        onUnauthorized: () => undefined,
      });

    const api = await startLocalApi(userId);
    try {
      const engine = makeRevEngine(api.url);
      await engine.syncNow("startup");

      // Create and sync a board, so the server now holds an existing entity.
      await createBoard({ name: "Rev 0" }, "local-user", getDb());
      await engine.syncNow("local-change");

      const [board] = await getDb().select().from(boards);
      const id = board!.id;

      // Three sequential edits, each followed by a full sync cycle. Before the
      // fix every one of these was rejected (baseRevision omitted) and the
      // outbox row was dropped, so the server kept "Rev 0" forever.
      for (let i = 1; i <= 3; i += 1) {
        await updateBoard(id, { name: `Rev ${i}` }, "local-user", getDb());
        await engine.syncNow("local-change");
      }

      const remoteName = [...remote.workspaces.get(userId)!.values()].find(
        (row) => row.entityType === "board" && row.entityId === id && !row.deleted,
      )?.data.name;
      expect(remoteName).toBe("Rev 3");

      // No conflicts were archived and nothing is left pending.
      const state = await fetch(`${api.url}/api/sync/state`).then((r) => r.json());
      expect(state.state.pendingChanges).toBe(0);
    } finally {
      api.close();
      await mirror.close();
    }
  });

  it("does not self-conflict when the same card is moved again before the pull heals revisions", async () => {
    const userId = "user-rapid";
    const user = { id: userId, name: "Rapid", email: "rapid@example.test" };
    const mirror = await createTestDatabase();
    await mirror.client.execute(LOCAL_USER_STUB);
    await activateDatabase(mirror.url);

    const fakeClient = clientFor(user);
    const api = await startLocalApi(userId);
    const engine = new SyncEngine({
      getClient: () => fakeClient as unknown as PremiumApiClient,
      getLocalOrigin: () => api.url,
      isOnline: () => true,
      log: () => undefined,
      onStatus: () => undefined,
      onUnauthorized: () => undefined,
    });
    try {
      await engine.syncNow("startup");

      // Create a board and a task; sync so the server holds them at a known
      // revision and the local revision table is healed.
      await createBoard({ name: "Rapid board" }, "local-user", getDb());
      const [board] = await getDb().select().from(boards);
      const detail = await getBoardDetail(board!.id, "local-user", getDb());
      const [source, second, third] = detail.columns;
      expect(source && second && third).toBeTruthy();
      const task = await createTask(
        board!.id,
        { columnId: source!.id, title: "Rapid card" },
        "local-user",
        getDb(),
      );
      await engine.syncNow("local-change");

      // First move. The push is accepted (revision advances on the server),
      // but the pull that normally heals the local revision table fails — a
      // flaky network is exactly the window where rapid consecutive moves
      // used to push a stale base revision and conflict with themselves.
      await updateTask(task.id, { columnId: second!.id }, "local-user", getDb());
      remote.failNextPull = true;
      await engine.syncNow("local-change");

      // Second move, made before any pull could heal the revision.
      await updateTask(task.id, { columnId: third!.id }, "local-user", getDb());
      await engine.syncNow("local-change");

      // The cloud holds the newest move and no conflict was recorded: the
      // second push carried the revision the first push was accepted at.
      const remoteTask = remote.entity(userId, "task", task.id);
      expect(remoteTask?.data.column_id).toBe(third!.id);
      expect(remote.conflictCount(userId)).toBe(0);

      const [localTask] = await getDb()
        .select()
        .from(tasks)
        .where(eq(tasks.id, task.id));
      expect(localTask?.columnId).toBe(third!.id);

      const state = await fetch(`${api.url}/api/sync/state`).then((r) => r.json());
      expect(state.state.pendingChanges).toBe(0);
      expect(state.state.conflictCount).toBe(0);
    } finally {
      api.close();
      await mirror.close();
    }
  });

  it("surfaces a conflict for user resolution instead of retrying it", async () => {
    const userId = "user-conflict";
    const user = { id: userId, name: "Conflict", email: "conflict@example.test" };
    const mirror = await createTestDatabase();
    await mirror.client.execute(LOCAL_USER_STUB);
    await activateDatabase(mirror.url);

    const fakeClient = clientFor(user);
    const api = await startLocalApi(userId);
    const engine = new SyncEngine({
      getClient: () => fakeClient as unknown as PremiumApiClient,
      getLocalOrigin: () => api.url,
      isOnline: () => true,
      log: () => undefined,
      onStatus: () => undefined,
      onUnauthorized: () => undefined,
    });
    try {
      await engine.syncNow("startup");
      await createBoard({ name: "Original" }, "local-user", getDb());
      await engine.syncNow("local-change");

      const [board] = await getDb().select().from(boards);
      expect(board).toBeDefined();
      remote.simulateRemoteEdit(userId, "board", board!.id, {
        id: board!.id,
        owner_id: "local-user",
        project_id: board!.projectId,
        type: board!.type,
        name: "Cloud edit",
        description: null,
        color: board!.color,
        position: board!.position,
        created_at: board!.createdAt.getTime(),
        updated_at: Date.now(),
      });
      await updateBoard(board!.id, { name: "Local edit" }, "local-user", getDb());

      await engine.syncNow("conflict");

      const conflicts = await listSyncConflicts();
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({
        entityType: "board",
        entityId: board!.id,
        incomingData: expect.objectContaining({ name: "Local edit" }),
        winningData: expect.objectContaining({ name: "Cloud edit" }),
      });

      const [localBoard] = await getDb()
        .select()
        .from(boards)
        .where(eq(boards.id, board!.id));
      expect(localBoard?.name).toBe("Local edit");
      const remoteBoard = [...remote.workspaces.get(userId)!.values()].find(
        (row) => row.entityType === "board" && row.entityId === board!.id,
      );
      expect(remoteBoard?.data.name).toBe("Cloud edit");
      const state = await fetch(`${api.url}/api/sync/state`).then((r) => r.json());
      expect(state.state.conflictCount).toBe(1);
      expect(state.state.pendingChanges).toBe(0);
    } finally {
      api.close();
      await mirror.close();
    }
  });

  it("converges simultaneous task moves after the user keeps a version", async () => {
    const userId = "user-task-conflict";
    const user = {
      id: userId,
      name: "Task conflict",
      email: "task-conflict@example.test",
    };
    const mirrorA = await createTestDatabase();
    const mirrorB = await createTestDatabase();
    await mirrorA.client.execute(LOCAL_USER_STUB);
    await mirrorB.client.execute(LOCAL_USER_STUB);
    const fakeClient = clientFor(user);

    const withApi = async <T,>(
      db: TestDatabase,
      operation: (origin: string) => Promise<T>,
    ): Promise<T> => {
      await activateDatabase(db.url);
      const api = await startLocalApi(userId);
      try {
        return await operation(api.url);
      } finally {
        api.close();
      }
    };
    const engineFor = (origin: string) =>
      new SyncEngine({
        getClient: () => fakeClient as unknown as PremiumApiClient,
        getLocalOrigin: () => origin,
        isOnline: () => true,
        log: () => undefined,
        onStatus: () => undefined,
        onUnauthorized: () => undefined,
      });

    try {
      let boardId = "";
      let taskId = "";
      let columnA = "";
      let columnB = "";

      await withApi(mirrorA, async (origin) => {
        const engine = engineFor(origin);
        await engine.syncNow("startup");
        const board = await createBoard(
          { name: "Task conflict board" },
          "local-user",
          getDb(),
        );
        boardId = board.id;
        const detail = await getBoardDetail(board.id, "local-user", getDb());
        columnA = detail.columns[1]!.id;
        columnB = detail.columns[2]!.id;
        const task = await createTask(
          board.id,
          { columnId: detail.columns[0]!.id, title: "Move me" },
          "local-user",
          getDb(),
        );
        taskId = task.id;
        await engine.syncNow("local-change");
      });

      await withApi(mirrorB, async (origin) => {
        await engineFor(origin).syncNow("startup");
      });

      await withApi(mirrorA, async (origin) => {
        await updateTask(taskId, { columnId: columnA }, "local-user", getDb());
        await engineFor(origin).syncNow("local-change");
      });

      await withApi(mirrorB, async (origin) => {
        await updateTask(taskId, { columnId: columnB }, "local-user", getDb());
        const engine = engineFor(origin);
        await engine.syncNow("conflict");

        const conflicts = await listSyncConflicts();
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0]).toMatchObject({
          entityType: "task",
          entityId: taskId,
        });
        const remoteConflict = await remote.getConflict(userId, conflicts[0]!.id);
        expect(remoteConflict.current).not.toBeNull();
        await remote.resolveConflict(userId, conflicts[0]!.id, "local");
        await keepLocalConflict(
          conflicts[0]!.id,
          remoteConflict.current!.revision,
        );
        await engine.syncNow("resolve-local");
      });

      await withApi(mirrorA, async (origin) => {
        await engineFor(origin).syncNow("pull-resolution");
        const detail = await getBoardDetail(boardId, "local-user", getDb());
        expect(detail.tasks.find((task) => task.id === taskId)?.columnId).toBe(
          columnB,
        );
      });

      await withApi(mirrorB, async () => {
        const detail = await getBoardDetail(boardId, "local-user", getDb());
        expect(detail.tasks.find((task) => task.id === taskId)?.columnId).toBe(
          columnB,
        );
      });
    } finally {
      await mirrorA.close();
      await mirrorB.close();
    }
  });

  it("converges concurrent whiteboard saves without conflicts", async () => {
    const userId = "user-whiteboard";
    const user = {
      id: userId,
      name: "Whiteboard",
      email: "whiteboard@example.test",
    };
    const mirrorA = await createTestDatabase();
    const mirrorB = await createTestDatabase();
    await mirrorA.client.execute(LOCAL_USER_STUB);
    await mirrorB.client.execute(LOCAL_USER_STUB);
    const fakeClient = clientFor(user);

    const withApi = async <T,>(
      db: TestDatabase,
      operation: (origin: string) => Promise<T>,
    ): Promise<T> => {
      await activateDatabase(db.url);
      const api = await startLocalApi(userId);
      try {
        return await operation(api.url);
      } finally {
        api.close();
      }
    };
    const engineFor = (origin: string) =>
      new SyncEngine({
        getClient: () => fakeClient as unknown as PremiumApiClient,
        getLocalOrigin: () => origin,
        isOnline: () => true,
        log: () => undefined,
        onStatus: () => undefined,
        onUnauthorized: () => undefined,
      });
    const scene = (label: string) =>
      JSON.stringify({
        elements: [{ id: label, version: 1 }],
        appState: {},
        files: {},
      });

    try {
      let boardId = "";
      await withApi(mirrorA, async (origin) => {
        const engine = engineFor(origin);
        await engine.syncNow("startup");
        const board = await createBoard(
          { name: "Shared canvas", type: "whiteboard" },
          "local-user",
          getDb(),
        );
        boardId = board.id;
        await engine.syncNow("local-change");
      });

      await withApi(mirrorB, async (origin) => {
        await engineFor(origin).syncNow("startup");
      });

      // Device A saves and pushes a new scene.
      await withApi(mirrorA, async (origin) => {
        await saveWhiteboardScene(boardId, scene("cloud"), "local-user", getDb());
        await engineFor(origin).syncNow("local-change");
      });

      // Device B has not pulled that change yet, so its snapshot is based on a
      // stale revision. The server must accept it (last-write-wins) instead of
      // recording a whiteboard conflict, and saving a scene must not queue a
      // phantom board change.
      await withApi(mirrorB, async (origin) => {
        await saveWhiteboardScene(boardId, scene("local"), "local-user", getDb());
        const pending = await getClient().execute(
          "select entity_type from sync_changes",
        );
        expect(pending.rows.map((row) => row.entity_type)).toEqual(["whiteboard"]);

        await engineFor(origin).syncNow("local-change");
        expect(await listSyncConflicts()).toEqual([]);
      });

      // Device A converges on B's last-written scene.
      await withApi(mirrorA, async (origin) => {
        await engineFor(origin).syncNow("pull");
        const result = await getClient().execute({
          sql: "select scene from whiteboards where board_id = ?",
          args: [boardId],
        });
        expect(String(result.rows[0]?.scene)).toBe(scene("local"));
      });
    } finally {
      await mirrorA.close();
      await mirrorB.close();
    }
  });

  it("reports sync status that ends in idle without pending changes", async () => {    await activateDatabase(mirrorA.url);
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
