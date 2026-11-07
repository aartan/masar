import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { boards } from "@/db/schema";
import { getClient, getDb } from "@/db";
import { getLocalUser, LOCAL_USER_ID } from "@/lib/server/desktop";
import { createBoard, getBoardDetail } from "@/lib/server/boards";
import { saveWhiteboardScene } from "@/lib/server/whiteboards";
import { createTask, reorderTasks } from "@/lib/server/tasks";
import { updateBoard } from "@/lib/server/boards";
import {
  acknowledgeChanges,
  applyCloudConflict,
  applyRemoteChanges,
  getSyncState,
  keepLocalConflict,
  listPendingChanges,
  listSyncConflicts,
  prepareSync,
  recordSyncConflicts,
} from "@/sync/local";
import type { BoardSummary } from "@/lib/types";
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
  // Boards cascade-delete columns/tasks/whiteboards; clear the remaining
  // top-level tables and sync bookkeeping so each test starts clean.
  await client.execute("delete from projects");
  await client.execute("delete from sync_changes");
  await client.execute("delete from sync_entity_revisions");
  await client.execute("delete from sync_conflicts");
  await client.execute(
    "update sync_state set remote_user_id = null, last_revision = 0, last_synced_at = null, bootstrapped = 0, applying = 0 where id = 1",
  );
});

async function makeBoard(name = "Sync board") {
  const board = await createBoard({ name }, LOCAL_USER_ID, test.db);
  const detail = await getBoardDetail(board.id, LOCAL_USER_ID, test.db);
  return { board, detail };
}

function boardData(board: BoardSummary, name: string, updatedAt: number) {
  return {
    id: board.id,
    owner_id: LOCAL_USER_ID,
    project_id: board.projectId,
    type: board.type,
    name,
    description: board.description,
    color: board.color,
    position: board.position,
    created_at: Date.parse(board.createdAt),
    updated_at: updatedAt,
  };
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

  it("queues only the tasks affected by a reorder", async () => {
    await prepareSync("remote-user-a");
    const { board, detail } = await makeBoard("Reorder board");
    const [firstColumn, secondColumn, thirdColumn] = detail.columns;
    const first = await createTask(
      board.id,
      { columnId: firstColumn!.id, title: "First" },
      LOCAL_USER_ID,
      test.db,
    );
    const second = await createTask(
      board.id,
      { columnId: secondColumn!.id, title: "Second" },
      LOCAL_USER_ID,
      test.db,
    );
    const third = await createTask(
      board.id,
      { columnId: thirdColumn!.id, title: "Third" },
      LOCAL_USER_ID,
      test.db,
    );

    const allDetail = await getBoardDetail(board.id, LOCAL_USER_ID, test.db);
    await getClient().execute("delete from sync_changes");

    await reorderTasks(
      board.id,
      {
        columns: allDetail.columns.map((column) => ({
          columnId: column.id,
          taskIds:
            column.id === firstColumn!.id
              ? []
              : column.id === secondColumn!.id
                ? [second.id, first.id]
                : column.id === thirdColumn!.id
                  ? [third.id]
                  : [],
        })),
      },
      LOCAL_USER_ID,
      test.db,
    );

    const pending = await listPendingChanges(0, 500);
    const taskChanges = pending.filter((change) => change.entityType === "task");
    expect(taskChanges).toHaveLength(1);
    expect(taskChanges[0]?.entityId).toBe(first.id);
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
    expect(row?.projectId).toBeTruthy();
    // The board has no project in the legacy payload, so a default project is
    // synthesized and queued for creation. The board itself must not echo.
    const pending = await listPendingChanges(0, 500);
    expect(pending.filter((change) => change.entityType === "board")).toHaveLength(0);
    expect(pending.filter((change) => change.entityType === "project")).toHaveLength(1);
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


  it("applies project and whiteboard entities and records their revisions", async () => {
    await prepareSync("remote-user-a");
    const now = Date.now();

    const result = await applyRemoteChanges(5, [
      {
        entityType: "project",
        entityId: "remote-project-1",
        deleted: false,
        data: {
          id: "remote-project-1",
          name: "Remote project",
          position: 0,
          archived: false,
          archived_at: null,
          created_at: now,
          updated_at: now,
        },
        updatedAt: new Date(now).toISOString(),
        revision: 4,
      },
      {
        entityType: "board",
        entityId: "remote-wb-board",
        deleted: false,
        data: {
          id: "remote-wb-board",
          project_id: "remote-project-1",
          type: "whiteboard",
          name: "Canvas",
          description: null,
          color: "sage",
          position: 0,
          created_at: now,
          updated_at: now,
        },
        updatedAt: new Date(now).toISOString(),
        revision: 5,
      },
      {
        entityType: "whiteboard",
        entityId: "remote-wb-board",
        deleted: false,
        data: {
          id: "remote-wb-board",
          board_id: "remote-wb-board",
          scene: '{"elements":[{"id":"a"}]}',
          updated_at: now,
        },
        updatedAt: new Date(now).toISOString(),
        revision: 6,
      },
    ]);

    expect(result.applied).toBe(3);
    expect(result.skipped).toEqual([]);

    // The board landed in the project with the whiteboard type.
    const [board] = await test.db
      .select()
      .from(boards)
      .where(eq(boards.id, "remote-wb-board"));
    expect(board?.type).toBe("whiteboard");
    expect(board?.projectId).toBe("remote-project-1");

    // The scene persisted and the base revision was recorded for the push path.
    const scene = await getClient().execute({
      sql: "select scene from whiteboards where board_id = ?",
      args: ["remote-wb-board"],
    });
    expect(String(scene.rows[0]?.scene)).toContain("elements");

    const revisions = await getClient().execute(
      "select entity_type, revision from sync_entity_revisions order by revision",
    );
    const byType = new Map(
      revisions.rows.map((row) => [String(row.entity_type), Number(row.revision)]),
    );
    expect(byType.get("project")).toBe(4);
    expect(byType.get("board")).toBe(5);
    expect(byType.get("whiteboard")).toBe(6);
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


  it("coalesces repeated whiteboard snapshots in the outbox", async () => {
    await prepareSync("remote-user-a");
    const board = await createBoard(
      { name: "Canvas", type: "whiteboard" },
      LOCAL_USER_ID,
      test.db,
    );

    await saveWhiteboardScene(
      board.id,
      '{"elements":[{"id":"one"}]}',
      LOCAL_USER_ID,
      test.db,
    );
    await saveWhiteboardScene(
      board.id,
      '{"elements":[{"id":"two"}]}',
      LOCAL_USER_ID,
      test.db,
    );

    const pending = await listPendingChanges(0, 500);
    const whiteboardChanges = pending.filter(
      (change) => change.entityType === "whiteboard",
    );
    expect(whiteboardChanges).toHaveLength(1);
    expect(String(whiteboardChanges[0]?.data.scene)).toContain('"id":"two"');
  });

  it("does not queue a board change when a whiteboard scene is saved", async () => {
    await prepareSync("remote-user-a");
    const board = await createBoard(
      { name: "Canvas", type: "whiteboard" },
      LOCAL_USER_ID,
      test.db,
    );
    await getClient().execute("delete from sync_changes");

    await saveWhiteboardScene(
      board.id,
      '{"elements":[]}',
      LOCAL_USER_ID,
      test.db,
    );

    const pending = await listPendingChanges(0, 500);
    expect(pending.map((change) => change.entityType)).toEqual(["whiteboard"]);
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

  it("keeps the tombstone revision when a newer local edit survives a remote delete", async () => {
    await prepareSync("remote-user-a");
    const { board } = await makeBoard("Keep me");
    const now = Date.now();

    await applyRemoteChanges(1, [
      {
        entityType: "board",
        entityId: board.id,
        deleted: false,
        data: boardData(board, "Remote original", now - 5_000),
        updatedAt: new Date(now - 5_000).toISOString(),
        revision: 1,
      },
    ]);
    await updateBoard(board.id, { name: "Local newer" }, LOCAL_USER_ID, test.db);

    const result = await applyRemoteChanges(2, [
      {
        entityType: "board",
        entityId: board.id,
        deleted: true,
        data: {},
        updatedAt: new Date(now - 60_000).toISOString(),
        revision: 2,
      },
    ]);

    expect(result.skipped.some((item) => item.entityId === board.id)).toBe(true);
    const revisions = await getClient().execute(
      "select revision from sync_entity_revisions where entity_type = 'board' and entity_id = ?",
      [board.id],
    );
    expect(Number(revisions.rows[0]?.revision)).toBe(2);
    const pending = await listPendingChanges(0, 50);
    const boardChange = pending.find((change) => change.entityId === board.id);
    expect(boardChange?.baseRevision).toBe(2);
  });

  it("records conflicts, skips pull for them, and applies the cloud choice", async () => {
    await prepareSync("remote-user-a");
    const { board } = await makeBoard("Conflict board");
    const now = Date.now();
    await recordSyncConflicts([
      {
        id: "conflict-1",
        entityType: "board",
        entityId: board.id,
        incomingDeleted: false,
        incomingData: boardData(board, "Mine", now),
        incomingUpdatedAt: new Date(now).toISOString(),
        winningDeleted: false,
        winningData: boardData(board, "Cloud", now + 1_000),
        winningUpdatedAt: new Date(now + 1_000).toISOString(),
        revision: 3,
        createdAt: new Date(now + 1_000).toISOString(),
      },
    ]);

    const conflicts = await listSyncConflicts();
    expect(conflicts).toHaveLength(1);
    expect((await getSyncState()).conflictCount).toBe(1);

    const skipped = await applyRemoteChanges(4, [
      {
        entityType: "board",
        entityId: board.id,
        deleted: false,
        data: boardData(board, "New cloud", now + 2_000),
        updatedAt: new Date(now + 2_000).toISOString(),
        revision: 4,
      },
    ]);
    expect(
      skipped.skipped.some((item) => item.reason === "Conflict awaiting resolution"),
    ).toBe(true);

    await applyCloudConflict("conflict-1", {
      deleted: false,
      data: boardData(board, "Cloud resolved", now + 3_000),
      updatedAt: new Date(now + 3_000).toISOString(),
      revision: 5,
    });

    const [resolved] = await test.db
      .select()
      .from(boards)
      .where(eq(boards.id, board.id));
    expect(resolved?.name).toBe("Cloud resolved");
    expect(await listSyncConflicts()).toHaveLength(0);
    const revision = await getClient().execute(
      "select revision from sync_entity_revisions where entity_type = 'board' and entity_id = ?",
      [board.id],
    );
    expect(Number(revision.rows[0]?.revision)).toBe(5);
  });

  it("requeues the local conflict snapshot against the latest revision", async () => {
    await prepareSync("remote-user-a");
    const { board } = await makeBoard("Keep mine");
    const now = Date.now();
    await recordSyncConflicts([
      {
        id: "conflict-2",
        entityType: "board",
        entityId: board.id,
        incomingDeleted: false,
        incomingData: boardData(board, "My version", now),
        incomingUpdatedAt: new Date(now).toISOString(),
        winningDeleted: false,
        winningData: boardData(board, "Cloud version", now + 1_000),
        winningUpdatedAt: new Date(now + 1_000).toISOString(),
        revision: 6,
        createdAt: new Date(now + 1_000).toISOString(),
      },
    ]);

    await keepLocalConflict("conflict-2", 7);
    expect(await listSyncConflicts()).toHaveLength(0);
    const pending = await listPendingChanges(0, 50);
    const change = pending.find((item) => item.entityId === board.id);
    expect(change?.data.name).toBe("My version");
    expect(change?.baseRevision).toBe(7);
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
