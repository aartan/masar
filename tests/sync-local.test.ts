import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { boards } from "@/db/schema";
import { getClient, getDb } from "@/db";
import { getLocalUser, LOCAL_USER_ID } from "@/lib/server/desktop";
import { createBoard, getBoardDetail } from "@/lib/server/boards";
import { createTask } from "@/lib/server/tasks";
import { updateBoard } from "@/lib/server/boards";
import {
  acknowledgeChanges,
  applyRemoteChanges,
  getSyncState,
  listPendingChanges,
  prepareSync,
} from "@/sync/local";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";

let test: TestDatabase;
beforeAll(async () => {
  test = await createTestDatabase();
  process.env.DATABASE_URL = test.url;
  getDb();
  await getLocalUser();
});

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.db.delete(boards);
  const client = getClient();
  await client.execute("delete from sync_changes");
  await client.execute(
    "update sync_state set remote_user_id = null, last_revision = 0, last_synced_at = null, bootstrapped = 0, applying = 0 where id = 1",
  );
});

async function makeBoard(name = "Sync board") {
  const board = await createBoard({ name }, LOCAL_USER_ID, test.db);
  const detail = await getBoardDetail(board.id, LOCAL_USER_ID, test.db);
  return { board, detail };
}

describe("local sync outbox", () => {
  it("bootstraps existing local data on first sync", async () => {
    const { board, detail } = await makeBoard("Existing work");
    const state = await prepareSync("remote-user-a");
    expect(state.bootstrapped).toBe(true);

    const pending = await listPendingChanges(0, 500);
    expect(pending.some((change) => change.entityType === "board" && change.entityId === board.id)).toBe(true);
    expect(pending.filter((change) => change.entityType === "column")).toHaveLength(
      detail.columns.length,
    );
  });

  it("records inserts, updates and deletes once sync is prepared", async () => {
    await prepareSync("remote-user-a");
    const { board, detail } = await makeBoard("Tracked");
    await updateBoard(board.id, { name: "Renamed" }, LOCAL_USER_ID, test.db);
    const task = await createTask(
      board.id,
      { columnId: detail.columns[0]!.id, title: "A task" },
      LOCAL_USER_ID,
      test.db,
    );

    let pending = await listPendingChanges(0, 500);
    expect(pending.filter((change) => change.entityType === "board")).toHaveLength(2);
    expect(pending.some((change) => change.entityType === "task" && change.entityId === task.id)).toBe(true);

    const last = pending[pending.length - 1]!;
    await acknowledgeChanges(last.id);
    pending = await listPendingChanges(0, 500);
    expect(pending).toHaveLength(0);
  });

  it("applies remote changes without echoing them back and records their base revision", async () => {
    await prepareSync("remote-user-a");
    const now = Date.now();
    const result = await applyRemoteChanges(1, [
      {
        entityType: "board",
        entityId: "remote-board-1",
        deleted: false,
        data: {
          id: "remote-board-1",
          owner_id: "some-remote-user",
          name: "Remote board",
          description: null,
          color: "sky",
          position: 0,
          created_at: now,
          updated_at: now,
        },
        updatedAt: new Date(now).toISOString(),
        revision: 1,
      },
    ]);

    expect(result.applied).toBe(1);
    const [row] = await test.db
      .select()
      .from(boards)
      .where(eq(boards.id, "remote-board-1"));
    expect(row?.name).toBe("Remote board");
    expect(row?.ownerId).toBe(LOCAL_USER_ID);
    expect(await listPendingChanges(0, 500)).toHaveLength(0);
    const state = await getSyncState();
    expect(state.lastRevision).toBe(1);

    // The applied revision becomes the base for the next local edit.
    await updateBoard("remote-board-1", { name: "Sequential edit" }, LOCAL_USER_ID, test.db);
    const pending = await listPendingChanges(0, 500);
    const change = pending.find((item) => item.entityId === "remote-board-1");
    expect(change?.baseRevision).toBe(1);
  });

  it("applies the server version regardless of client clocks", async () => {
    await prepareSync("remote-user-a");
    const now = Date.now();
    await applyRemoteChanges(1, [
      {
        entityType: "board",
        entityId: "remote-board-2",
        deleted: false,
        data: {
          id: "remote-board-2",
          name: "Remote original",
          description: null,
          color: "sage",
          position: 0,
          created_at: now,
          updated_at: now,
        },
        updatedAt: new Date(now).toISOString(),
        revision: 1,
      },
    ]);
    await acknowledgeChanges(10_000);

    // A local edit with a skewed (future) clock must not win over the
    // server's version; causality is decided by revisions, not timestamps.
    await updateBoard("remote-board-2", { name: "Local skewed" }, LOCAL_USER_ID, test.db);
    await getClient().execute(
      "update sync_changes set data = json_set(data, '$.updated_at', ?) where entity_type = 'board' and entity_id = 'remote-board-2'",
      [Date.now() + 10 * 24 * 60 * 60 * 1000],
    );

    const remote = new Date(now + 60_000).toISOString();
    const result = await applyRemoteChanges(2, [
      {
        entityType: "board",
        entityId: "remote-board-2",
        deleted: false,
        data: {
          id: "remote-board-2",
          name: "Server winning version",
          description: null,
          color: "sage",
          position: 0,
          created_at: now,
          updated_at: now + 60_000,
        },
        updatedAt: remote,
        revision: 2,
      },
    ]);

    expect(result.applied).toBe(1);
    expect(result.skipped).toHaveLength(0);
    const [row] = await test.db
      .select()
      .from(boards)
      .where(eq(boards.id, "remote-board-2"));
    expect(row?.name).toBe("Server winning version");
  });


  it("compacts repeated offline edits to the newest state per entity", async () => {
    await prepareSync("remote-user-a");
    const { board } = await makeBoard("Compact me");
    await updateBoard(board.id, { name: "Compact 2" }, LOCAL_USER_ID, test.db);
    await updateBoard(board.id, { name: "Compact 3" }, LOCAL_USER_ID, test.db);

    let pending = await listPendingChanges(0, 500);
    expect(pending.filter((change) => change.entityId === board.id)).toHaveLength(3);

    await prepareSync("remote-user-a");
    pending = await listPendingChanges(0, 500);
    const boardChanges = pending.filter((change) => change.entityId === board.id);
    expect(boardChanges).toHaveLength(1);
    expect(boardChanges[0]?.data.name).toBe("Compact 3");
  });


  it("applies a server update after a local delete so replicas converge", async () => {
    await prepareSync("remote-user-a");
    const { board } = await makeBoard("Delete locally");
    await test.db.delete(boards).where(eq(boards.id, board.id));

    const remote = new Date(Date.now()).toISOString();
    const result = await applyRemoteChanges(3, [
      {
        entityType: "board",
        entityId: board.id,
        deleted: false,
        data: {
          id: board.id,
          name: "Recreated remotely",
          description: null,
          color: "sage",
          position: 0,
          created_at: Date.now() - 120_000,
          updated_at: Date.now(),
        },
        updatedAt: remote,
        revision: 3,
      },
    ]);

    // The server's update applies; the outbox tombstone stays queued so the
    // server can resolve it against the update by revision.
    expect(result.applied).toBe(1);
    const rows = await test.db.select().from(boards).where(eq(boards.id, board.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Recreated remotely");
    const pending = await listPendingChanges(0, 500);
    expect(
      pending.some((change) => change.entityId === board.id && change.deleted),
    ).toBe(true);
  });

  it("bootstraps legacy entities with the legacy base revision", async () => {
    await test.client.execute(
      "insert into sync_entity_state (entity_type, entity_id, base_revision) values ('board', 'legacy-board-9', -1)",
    );
    await test.db.insert(boards).values({
      id: "legacy-board-9",
      ownerId: LOCAL_USER_ID,
      name: "Legacy",
    });
    const state = await prepareSync("remote-user-a");
    expect(state.bootstrapped).toBe(true);

    const pending = await listPendingChanges(0, 500);
    const change = pending.find(
      (item) => item.entityType === "board" && item.entityId === "legacy-board-9",
    );
    expect(change?.baseRevision).toBe(-1);
  });

  it("refuses to reuse a sync database for a different premium account", async () => {
    await prepareSync("remote-user-a");
    await makeBoard("Local work");
    await acknowledgeChanges(10_000);
    const first = await getSyncState();
    expect(first.remoteUserId).toBe("remote-user-a");

    // A workspace database is bound to one premium account. Switching accounts
    // on the same file used to re-queue every row (including the previous
    // account's cloud data) for the new account; it must be refused instead.
    await expect(prepareSync("remote-user-b")).rejects.toThrow(
      /bound to premium account/,
    );

    const state = await getSyncState();
    expect(state.remoteUserId).toBe("remote-user-a");
    // Nothing was queued for the other account.
    expect(await listPendingChanges(0, 500)).toHaveLength(0);
  });
});
