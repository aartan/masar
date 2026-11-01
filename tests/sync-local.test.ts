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

  it("applies remote changes without echoing them back", async () => {
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
  });

  it("keeps a newer local edit and queues it when an older remote change arrives", async () => {
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

    await updateBoard("remote-board-2", { name: "Local newer" }, LOCAL_USER_ID, test.db);
    await getClient().execute("delete from sync_changes");

    const older = new Date(now - 60_000).toISOString();
    const result = await applyRemoteChanges(2, [
      {
        entityType: "board",
        entityId: "remote-board-2",
        deleted: false,
        data: {
          id: "remote-board-2",
          name: "Remote older",
          description: null,
          color: "sage",
          position: 0,
          created_at: now - 60_000,
          updated_at: now - 60_000,
        },
        updatedAt: older,
        revision: 2,
      },
    ]);

    expect(result.skipped).toEqual([
      expect.objectContaining({ entityId: "remote-board-2", reason: "Local change is newer" }),
    ]);
    const [row] = await test.db
      .select()
      .from(boards)
      .where(eq(boards.id, "remote-board-2"));
    expect(row?.name).toBe("Local newer");
    const pending = await listPendingChanges(0, 10);
    expect(pending.some((change) => change.entityId === "remote-board-2")).toBe(true);
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


  it("does not let an older remote update resurrect a locally deleted entity", async () => {
    await prepareSync("remote-user-a");
    const { board } = await makeBoard("Delete locally");
    await test.db.delete(boards).where(eq(boards.id, board.id));

    const older = new Date(Date.now() - 60_000).toISOString();
    const result = await applyRemoteChanges(3, [
      {
        entityType: "board",
        entityId: board.id,
        deleted: false,
        data: {
          id: board.id,
          name: "Resurrected",
          description: null,
          color: "sage",
          position: 0,
          created_at: Date.now() - 120_000,
          updated_at: Date.now() - 60_000,
        },
        updatedAt: older,
        revision: 3,
      },
    ]);

    expect(result.skipped.some((item) => item.entityId === board.id)).toBe(true);
    const rows = await test.db.select().from(boards).where(eq(boards.id, board.id));
    expect(rows).toHaveLength(0);
    const pending = await listPendingChanges(0, 500);
    expect(
      pending.some((change) => change.entityId === board.id && change.deleted),
    ).toBe(true);
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
