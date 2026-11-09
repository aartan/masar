import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { createLocalApp } from "@/server/app";
import { boards, columns, tasks } from "@/db/schema";
import { getDb } from "@/db";
import { getLocalUser, LOCAL_USER_ID } from "@/lib/server/desktop";
import { listPendingChanges } from "@/sync/local";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";

/**
 * The local API must only ever mutate sync state when the Electron main
 * process started it as a premium sync mirror (`MASAR_SYNC_SCOPE`). The
 * ordinary local-workspace server never sets the scope, so stray sync requests
 * can never write remote data into the local workspace.
 */
let test: TestDatabase;
let app: ReturnType<typeof createLocalApp>;

beforeAll(async () => {
  test = await createTestDatabase();
  process.env.DATABASE_URL = test.url;
  getDb();
  await getLocalUser();
  app = createLocalApp();
});

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  delete process.env.MASAR_SYNC_SCOPE;
  delete process.env.MASAR_SYNC_USER_NAME;
  delete process.env.MASAR_SYNC_USER_EMAIL;
  delete process.env.MASAR_LOCAL_DB_URL;
  await test.db.delete(boards);
  await test.client.execute("delete from sync_changes");
  await test.client.execute("delete from sync_conflicts");
  await test.client.execute(
    "update sync_state set remote_user_id = null, last_revision = 0, last_synced_at = null, bootstrapped = 0, applying = 0 where id = 1",
  );
});

afterEach(async () => {
  delete process.env.MASAR_SYNC_SCOPE;
  delete process.env.MASAR_SYNC_USER_NAME;
  delete process.env.MASAR_SYNC_USER_EMAIL;
  delete process.env.MASAR_LOCAL_DB_URL;
});

async function request(path: string, init: RequestInit = {}) {
  return app.request(`http://localhost${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("sync route workspace scoping", () => {
  it("rejects sync mutations when the server has no sync scope", async () => {
    const prepare = await request("/api/sync/prepare", {
      method: "POST",
      body: JSON.stringify({ remoteUserId: "remote-user-a" }),
    });
    expect(prepare.status).toBe(409);
    expect(await json<{ error: string }>(prepare)).toMatchObject({
      error: expect.stringContaining("not connected to premium sync"),
    });

    const apply = await request("/api/sync/apply", {
      method: "POST",
      body: JSON.stringify({ nextRevision: 1, changes: [] }),
    });
    expect(apply.status).toBe(409);

    const ack = await request("/api/sync/ack", {
      method: "POST",
      body: JSON.stringify({ throughId: 0 }),
    });
    expect(ack.status).toBe(409);

    const importLocal = await request("/api/sync/import-local", {
      method: "POST",
    });
    expect(importLocal.status).toBe(409);
  });

  it("rejects a prepare for a different account than the bound workspace", async () => {
    process.env.MASAR_SYNC_SCOPE = "remote-user-a";
    const response = await request("/api/sync/prepare", {
      method: "POST",
      body: JSON.stringify({ remoteUserId: "remote-user-b" }),
    });
    expect(response.status).toBe(409);
    expect(await json<{ error: string }>(response)).toMatchObject({
      error: expect.stringContaining("different premium account"),
    });
  });

  it("accepts prepare, apply and ack when the scope matches", async () => {
    process.env.MASAR_SYNC_SCOPE = "remote-user-a";

    const prepare = await request("/api/sync/prepare", {
      method: "POST",
      body: JSON.stringify({ remoteUserId: "remote-user-a" }),
    });
    expect(prepare.status).toBe(200);

    const now = Date.now();
    const apply = await request("/api/sync/apply", {
      method: "POST",
      body: JSON.stringify({
        nextRevision: 1,
        changes: [
          {
            entityType: "board",
            entityId: "remote-board-1",
            deleted: false,
            data: {
              id: "remote-board-1",
              name: "Remote board",
              description: null,
              position: 0,
              created_at: now,
              updated_at: now,
            },
            updatedAt: new Date(now).toISOString(),
            revision: 1,
          },
        ],
      }),
    });
    expect(apply.status).toBe(200);

    const ack = await request("/api/sync/ack", {
      method: "POST",
      body: JSON.stringify({ throughId: 1_000_000 }),
    });
    expect(ack.status).toBe(200);

    const [row] = await test.db
      .select()
      .from(boards)
      .where(eq(boards.id, "remote-board-1"));
    expect(row?.name).toBe("Remote board");
  });

  it("records, lists, and resolves local sync conflicts", async () => {
    process.env.MASAR_SYNC_SCOPE = "remote-user-a";
    await request("/api/sync/prepare", {
      method: "POST",
      body: JSON.stringify({ remoteUserId: "remote-user-a" }),
    });
    const now = Date.now();
    await request("/api/sync/apply", {
      method: "POST",
      body: JSON.stringify({
        nextRevision: 1,
        changes: [
          {
            entityType: "board",
            entityId: "conflict-board",
            deleted: false,
            data: {
              id: "conflict-board",
              name: "Cloud original",
              description: null,
              position: 0,
              created_at: now,
              updated_at: now,
            },
            updatedAt: new Date(now).toISOString(),
            revision: 1,
          },
        ],
      }),
    });

    const record = await request("/api/sync/conflicts/record", {
      method: "POST",
      body: JSON.stringify({
        conflicts: [
          {
            id: "conflict-1",
            entityType: "board",
            entityId: "conflict-board",
            incomingDeleted: false,
            incomingData: { id: "conflict-board", name: "Local version" },
            incomingUpdatedAt: new Date(now).toISOString(),
            winningDeleted: false,
            winningData: { id: "conflict-board", name: "Cloud original" },
            winningUpdatedAt: new Date(now + 1_000).toISOString(),
            revision: 1,
            createdAt: new Date(now + 1_000).toISOString(),
          },
        ],
      }),
    });
    expect(record.status).toBe(200);

    const list = await request("/api/sync/conflicts");
    const listed = await json<{ conflicts: Array<{ id: string; entityLabel: string | null }> }>(
      list,
    );
    expect(listed.conflicts).toHaveLength(1);
    expect(listed.conflicts[0]).toMatchObject({ id: "conflict-1" });

    const resolved = await request(
      "/api/sync/conflicts/conflict-1/apply-cloud",
      {
        method: "POST",
        body: JSON.stringify({
          current: {
            deleted: false,
            data: {
              id: "conflict-board",
              name: "Cloud resolved",
              description: null,
              position: 0,
              created_at: now,
              updated_at: now + 2_000,
            },
            updatedAt: new Date(now + 2_000).toISOString(),
            revision: 2,
          },
        }),
      },
    );
    expect(resolved.status).toBe(200);

    const [row] = await test.db
      .select()
      .from(boards)
      .where(eq(boards.id, "conflict-board"));
    expect(row?.name).toBe("Cloud resolved");
    expect(await json<{ conflicts: unknown[] }>(await request("/api/sync/conflicts"))).toEqual({
      conflicts: [],
    });
  });

  it("records more than a hundred conflicts in one local call", async () => {
    process.env.MASAR_SYNC_SCOPE = "remote-user-a";
    await request("/api/sync/prepare", {
      method: "POST",
      body: JSON.stringify({ remoteUserId: "remote-user-a" }),
    });
    const now = new Date().toISOString();
    const conflicts = Array.from({ length: 120 }, (_, index) => ({
      id: `bulk-conflict-${index}`,
      entityType: "project",
      entityId: `bulk-project-${index}`,
      incomingDeleted: false,
      incomingData: { id: `bulk-project-${index}`, name: `Local ${index}` },
      incomingUpdatedAt: now,
      winningDeleted: false,
      winningData: { id: `bulk-project-${index}`, name: `Cloud ${index}` },
      winningUpdatedAt: now,
      revision: index + 1,
      createdAt: now,
    }));

    const recorded = await request("/api/sync/conflicts/record", {
      method: "POST",
      body: JSON.stringify({ conflicts }),
    });
    expect(recorded.status).toBe(200);

    const list = await json<{ conflicts: unknown[] }>(
      await request("/api/sync/conflicts"),
    );
    expect(list.conflicts).toHaveLength(120);
  });

  it("reports the premium account through /api/me in sync mode", async () => {
    process.env.MASAR_SYNC_SCOPE = "remote-user-a";
    process.env.MASAR_SYNC_USER_NAME = "Premium Person";
    process.env.MASAR_SYNC_USER_EMAIL = "premium@example.test";

    const response = await request("/api/me");
    expect(response.status).toBe(200);
    expect(await json<{ user: { name: string; email: string } }>(response)).toMatchObject({
      user: { name: "Premium Person", email: "premium@example.test" },
    });

    delete process.env.MASAR_SYNC_SCOPE;
    delete process.env.MASAR_SYNC_USER_NAME;
    delete process.env.MASAR_SYNC_USER_EMAIL;
    const local = await request("/api/me");
    expect(await json<{ user: { name: string } }>(local)).toMatchObject({
      user: { name: "Local workspace" },
    });
  });
});

describe("import local workspace", () => {
  it("copies the local workspace into the sync mirror without touching the source", async () => {
    process.env.MASAR_SYNC_SCOPE = "remote-user-a";

    const source = await createTestDatabase();
    try {
      const timestamp = 1_700_000_000_000;
      await source.client.execute({
        sql: `INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
               VALUES ('local-user', 'Local workspace', 'local@masar.app', 1, ?, ?)`,
        args: [timestamp, timestamp],
      });
      await source.client.batch(
        [
          `INSERT INTO boards (id, owner_id, name, description, position, created_at, updated_at)
             VALUES ('local-board-1', 'local-user', 'Local board', NULL, 0, ${timestamp}, ${timestamp})`,
          `INSERT INTO columns (id, board_id, name, position, is_done, created_at, updated_at)
             VALUES ('local-column-1', 'local-board-1', 'To Do', 0, 0, ${timestamp}, ${timestamp})`,
          `INSERT INTO tasks (id, board_id, column_id, title, priority, position, created_at, updated_at)
             VALUES ('local-task-1', 'local-board-1', 'local-column-1', 'Local task', 'high', 0, ${timestamp}, ${timestamp})`,
        ],
        "write",
      );
      process.env.MASAR_LOCAL_DB_URL = source.url;

      const response = await request("/api/sync/import-local", {
        method: "POST",
      });
      expect(response.status).toBe(201);
      expect(await json<{ boards: number; tasks: number }>(response)).toEqual({
        boards: 1,
        tasks: 1,
      });

      // The mirror owns the copied board under its implicit account.
      const [board] = await test.db
        .select()
        .from(boards)
        .where(eq(boards.id, "local-board-1"));
      expect(board?.ownerId).toBe(LOCAL_USER_ID);

      const [column] = await test.db
        .select()
        .from(columns)
        .where(eq(columns.id, "local-column-1"));
      expect(column?.boardId).toBe("local-board-1");

      const [task] = await test.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, "local-task-1"));
      expect(task?.title).toBe("Local task");

      // The triggers queue the imported rows for the next sync push.
      const pending = await listPendingChanges(0, 500);
      expect(
        pending.some((change) => change.entityType === "board" && change.entityId === "local-board-1"),
      ).toBe(true);

      // The local workspace file is untouched.
      const [sourceBoard] = await source.db
        .select()
        .from(boards)
        .where(eq(boards.id, "local-board-1"));
      expect(sourceBoard?.ownerId).toBe("local-user");
    } finally {
      await source.close();
    }
  });

  it("is idempotent when imported twice", async () => {
    process.env.MASAR_SYNC_SCOPE = "remote-user-a";

    const source = await createTestDatabase();
    try {
      const timestamp = 1_700_000_000_000;
      await source.client.execute({
        sql: `INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
               VALUES ('local-user', 'Local workspace', 'local@masar.app', 1, ?, ?)`,
        args: [timestamp, timestamp],
      });
      await source.client.execute({
        sql: `INSERT INTO boards (id, owner_id, name, position, created_at, updated_at)
               VALUES ('local-board-2', 'local-user', 'Twice', 0, ?, ?)`,
        args: [timestamp, timestamp],
      });
      process.env.MASAR_LOCAL_DB_URL = source.url;

      const first = await request("/api/sync/import-local", { method: "POST" });
      expect(first.status).toBe(201);
      const second = await request("/api/sync/import-local", { method: "POST" });
      expect(second.status).toBe(201);
      expect(await json<{ boards: number }>(second)).toMatchObject({ boards: 1 });

      const rows = await test.db
        .select()
        .from(boards)
        .where(eq(boards.id, "local-board-2"));
      expect(rows).toHaveLength(1);
    } finally {
      await source.close();
    }
  });

  it("refuses to import without a sync scope or local database url", async () => {
    const withoutScope = await request("/api/sync/import-local", {
      method: "POST",
    });
    expect(withoutScope.status).toBe(409);

    process.env.MASAR_SYNC_SCOPE = "remote-user-a";
    const withoutSource = await request("/api/sync/import-local", {
      method: "POST",
    });
    expect(withoutSource.status).toBe(409);
  });
});
