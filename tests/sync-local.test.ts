import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { boards, folders } from "@/db/schema";
import { getClient, getDb } from "@/db";
import { getLocalUser, LOCAL_USER_ID } from "@/lib/server/desktop";
import { createBoard, getBoardDetail } from "@/lib/server/boards";
import { createFolder } from "@/lib/server/folders";
import { saveWhiteboardScene } from "@/lib/server/whiteboards";
import { saveNoteDocument } from "@/lib/server/notes";
import { addTaskImage } from "@/lib/server/task-images";
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
import { pngDataUrl } from "./helpers/image-fixtures";
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
  await client.execute("delete from folders");
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

  it("bootstraps folders parent-first with their spaces and folder assignments", async () => {
    const rootBoard = await createBoard(
      { name: "Root space" },
      LOCAL_USER_ID,
      test.db,
    );
    const projectId = rootBoard.projectId!;
    const parent = await createFolder(
      { projectId, name: "Parent" },
      LOCAL_USER_ID,
      test.db,
    );
    const child = await createFolder(
      { projectId, parentId: parent.id, name: "Child" },
      LOCAL_USER_ID,
      test.db,
    );
    const nestedBoard = await createBoard(
      { name: "Nested space", projectId, folderId: child.id },
      LOCAL_USER_ID,
      test.db,
    );

    await prepareSync("remote-user-a");
    const pending = await listPendingChanges(0, 500);
    const folderChanges = pending.filter(
      (change) => change.entityType === "folder",
    );
    expect(folderChanges.map((change) => change.entityId)).toEqual([
      parent.id,
      child.id,
    ]);
    expect(folderChanges[1]?.data).toMatchObject({
      id: child.id,
      project_id: projectId,
      parent_id: parent.id,
    });
    expect(
      pending.find(
        (change) =>
          change.entityType === "board" && change.entityId === nestedBoard.id,
      )?.data,
    ).toMatchObject({ project_id: projectId, folder_id: child.id });
  });

  it("records inserts, updates and deletes once sync is prepared", async () => {
    await prepareSync("remote-user-a");
    const { board, detail } = await makeBoard("Tracked");
    await updateBoard(board.id, { name: "Renamed" }, LOCAL_USER_ID, test.db);
    const task = await createTask(
      board.id,
      { columnId: detail.columns[0]!.id, title: "A task", complexity: "L" },
      LOCAL_USER_ID,
      test.db,
    );

    let pending = await listPendingChanges(0, 500);
    expect(pending.filter((change) => change.entityType === "board")).toHaveLength(2);
    expect(pending.some((change) => change.entityType === "task" && change.entityId === task.id)).toBe(true);
    expect(
      pending.find(
        (change) => change.entityType === "task" && change.entityId === task.id,
      )?.data,
    ).toMatchObject({ complexity: "L" });

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

  it("applies incoming folders parent-first and links spaces to them", async () => {
    await prepareSync("remote-user-a");
    const now = Date.now();
    const remoteChange = (
      entityType: "project" | "folder" | "board",
      entityId: string,
      data: Record<string, unknown>,
    ) => ({
      entityType,
      entityId,
      deleted: false,
      data,
      updatedAt: new Date(now).toISOString(),
      revision: 1,
    });

    const result = await applyRemoteChanges(1, [
      // Deliberately child-first: the pull applies folders by depth.
      remoteChange("folder", "remote-child", {
        id: "remote-child",
        project_id: "remote-project",
        parent_id: "remote-parent",
        name: "Child",
        position: 0,
        created_at: now,
        updated_at: now,
      }),
      remoteChange("folder", "remote-parent", {
        id: "remote-parent",
        project_id: "remote-project",
        parent_id: null,
        name: "Parent",
        position: 0,
        created_at: now,
        updated_at: now,
      }),
      remoteChange("board", "remote-nested-board", {
        id: "remote-nested-board",
        project_id: "remote-project",
        folder_id: "remote-child",
        type: "kanban",
        name: "Nested remote space",
        description: null,
        position: 0,
        created_at: now,
        updated_at: now,
      }),
      remoteChange("project", "remote-project", {
        id: "remote-project",
        name: "Remote project",
        description: null,
        position: 0,
        archived: false,
        archived_at: null,
        created_at: now,
        updated_at: now,
      }),
    ]);

    expect(result.applied).toBe(4);
    expect(result.skipped).toHaveLength(0);
    const remoteFolders = await test.db.select().from(folders);
    expect(
      remoteFolders.find((folder) => folder.id === "remote-child"),
    ).toMatchObject({
      projectId: "remote-project",
      parentId: "remote-parent",
    });
    const [nested] = await test.db
      .select()
      .from(boards)
      .where(eq(boards.id, "remote-nested-board"));
    expect(nested).toMatchObject({
      projectId: "remote-project",
      folderId: "remote-child",
    });
    // Remote apply is suppressed, so nothing echoes back to the cloud.
    const pending = await listPendingChanges(0, 500);
    expect(pending.filter((change) => change.entityType === "folder")).toHaveLength(
      0,
    );
    expect(pending.filter((change) => change.entityType === "board")).toHaveLength(
      0,
    );
  });

  it("applies remote task size estimates", async () => {
    const { board, detail } = await makeBoard("Size board");
    await prepareSync("remote-user-a");
    const now = Date.now();

    const result = await applyRemoteChanges(1, [
      {
        entityType: "task",
        entityId: "remote-task-1",
        deleted: false,
        data: {
          id: "remote-task-1",
          board_id: board.id,
          column_id: detail.columns[0]!.id,
          title: "Remote estimated task",
          description: null,
          priority: "medium",
          complexity: "XL",
          due_date: null,
          assignee: null,
          position: 0,
          completed_at: null,
          created_at: now,
          updated_at: now,
        },
        updatedAt: new Date(now).toISOString(),
        revision: 1,
      },
    ]);

    expect(result.applied).toBe(1);
    const refreshed = await getBoardDetail(board.id, LOCAL_USER_ID, test.db);
    expect(
      refreshed.tasks.find((task) => task.id === "remote-task-1"),
    ).toMatchObject({ complexity: "XL" });
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

  it("keeps an unsynced local edit even when the remote timestamp is newer", async () => {
    await prepareSync("remote-user-a");
    const now = Date.now();
    await applyRemoteChanges(1, [
      {
        entityType: "board",
        entityId: "remote-board-3",
        deleted: false,
        data: {
          id: "remote-board-3",
          name: "Remote original",
          description: null,
          position: 0,
          created_at: now,
          updated_at: now,
        },
        updatedAt: new Date(now).toISOString(),
        revision: 1,
      },
    ]);
    await acknowledgeChanges(10_000);

    // An unsynced local edit queues an outbox row whose base revision is the
    // healed one from the pull above.
    await updateBoard("remote-board-3", { name: "Local unsynced" }, LOCAL_USER_ID, test.db);
    const pendingBefore = await listPendingChanges(0, 10);
    expect(pendingBefore.some((change) => change.entityId === "remote-board-3")).toBe(true);

    // The remote change claims a newer clock than the local edit. Clock
    // comparison alone would let it overwrite the unsynced edit; the pending
    // row must win locally and be re-pushed with the healed base revision.
    const newer = new Date(now + 120_000).toISOString();
    const result = await applyRemoteChanges(2, [
      {
        entityType: "board",
        entityId: "remote-board-3",
        deleted: false,
        data: {
          id: "remote-board-3",
          name: "Remote newer clock",
          description: null,
          position: 0,
          created_at: now,
          updated_at: now + 120_000,
        },
        updatedAt: newer,
        revision: 2,
      },
    ]);

    expect(result.skipped).toEqual([
      expect.objectContaining({ entityId: "remote-board-3", reason: "Local change is newer" }),
    ]);
    const [row] = await test.db
      .select()
      .from(boards)
      .where(eq(boards.id, "remote-board-3"));
    expect(row?.name).toBe("Local unsynced");
    // The pending edit now carries the revision the skipped change had.
    const pending = await listPendingChanges(0, 10);
    const change = pending.find((item) => item.entityId === "remote-board-3");
    expect(change?.baseRevision).toBe(2);
  });

  it("records accepted push revisions atomically with the outbox ack", async () => {
    await prepareSync("remote-user-a");
    const { board } = await makeBoard("Acked board");
    let pending = await listPendingChanges(0, 500);
    const last = pending[pending.length - 1]!;

    await acknowledgeChanges(last.id, [
      { entityType: "board", entityId: board.id, revision: 9 },
    ]);

    const revisions = await getClient().execute(
      "select revision from sync_entity_revisions where entity_type = 'board' and entity_id = ?",
      [board.id],
    );
    expect(Number(revisions.rows[0]?.revision)).toBe(9);

    pending = await listPendingChanges(0, 500);
    expect(pending.some((change) => change.entityId === board.id)).toBe(false);

    // Revisions only move forward: a replayed ack must not regress them.
    await acknowledgeChanges(10_000, [
      { entityType: "board", entityId: board.id, revision: 5 },
    ]);
    const after = await getClient().execute(
      "select revision from sync_entity_revisions where entity_type = 'board' and entity_id = ?",
      [board.id],
    );
    expect(Number(after.rows[0]?.revision)).toBe(9);
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

  it("coalesces repeated note snapshots in the outbox", async () => {
    await prepareSync("remote-user-a");
    const board = await createBoard(
      { name: "Log", type: "note" },
      LOCAL_USER_ID,
      test.db,
    );

    await saveNoteDocument(
      board.id,
      JSON.stringify([{ id: "one", type: "paragraph" }]),
      LOCAL_USER_ID,
      test.db,
    );
    await saveNoteDocument(
      board.id,
      JSON.stringify([{ id: "two", type: "paragraph" }]),
      LOCAL_USER_ID,
      test.db,
    );

    const pending = await listPendingChanges(0, 500);
    const noteChanges = pending.filter(
      (change) => change.entityType === "note",
    );
    expect(noteChanges).toHaveLength(1);
    expect(String(noteChanges[0]?.data.document)).toContain('"id":"two"');
  });

  it("does not queue a board change when a note document is saved", async () => {
    await prepareSync("remote-user-a");
    const board = await createBoard(
      { name: "Log", type: "note" },
      LOCAL_USER_ID,
      test.db,
    );
    await getClient().execute("delete from sync_changes");

    await saveNoteDocument(
      board.id,
      JSON.stringify([{ id: "one", type: "paragraph" }]),
      LOCAL_USER_ID,
      test.db,
    );

    const pending = await listPendingChanges(0, 500);
    expect(pending.map((change) => change.entityType)).toEqual(["note"]);
  });

  it("applies note entities and records their revisions", async () => {
    await prepareSync("remote-user-a");
    const now = Date.now();

    const result = await applyRemoteChanges(4, [
      {
        entityType: "board",
        entityId: "remote-note-board",
        deleted: false,
        data: {
          id: "remote-note-board",
          project_id: null,
          type: "note",
          name: "Remote note",
          description: null,
          position: 0,
          created_at: now,
          updated_at: now,
        },
        updatedAt: new Date(now).toISOString(),
        revision: 3,
      },
      {
        entityType: "note",
        entityId: "remote-note-board",
        deleted: false,
        data: {
          id: "remote-note-board",
          board_id: "remote-note-board",
          document: JSON.stringify([{ id: "a", type: "paragraph" }]),
          updated_at: now,
        },
        updatedAt: new Date(now).toISOString(),
        revision: 4,
      },
    ]);

    expect(result.applied).toBe(2);
    expect(result.skipped).toEqual([]);

    const [board] = await test.db
      .select()
      .from(boards)
      .where(eq(boards.id, "remote-note-board"));
    expect(board?.type).toBe("note");

    const document = await getClient().execute({
      sql: "select document from notes where board_id = ?",
      args: ["remote-note-board"],
    });
    expect(String(document.rows[0]?.document)).toContain('"id":"a"');

    const revisions = await getClient().execute(
      "select entity_type, revision from sync_entity_revisions order by revision",
    );
    const byType = new Map(
      revisions.rows.map((row) => [String(row.entity_type), Number(row.revision)]),
    );
    expect(byType.get("board")).toBe(3);
    expect(byType.get("note")).toBe(4);
  });

  it("applies a note tombstone and deletes the document row", async () => {
    await prepareSync("remote-user-a");
    const now = Date.now();
    await applyRemoteChanges(2, [
      {
        entityType: "board",
        entityId: "remote-note-board",
        deleted: false,
        data: {
          id: "remote-note-board",
          project_id: null,
          type: "note",
          name: "Remote note",
          description: null,
          position: 0,
          created_at: now,
          updated_at: now,
        },
        updatedAt: new Date(now).toISOString(),
        revision: 1,
      },
      {
        entityType: "note",
        entityId: "remote-note-board",
        deleted: false,
        data: {
          id: "remote-note-board",
          board_id: "remote-note-board",
          document: "[]",
          updated_at: now,
        },
        updatedAt: new Date(now).toISOString(),
        revision: 2,
      },
    ]);

    const result = await applyRemoteChanges(3, [
      {
        entityType: "note",
        entityId: "remote-note-board",
        deleted: true,
        data: {},
        updatedAt: new Date(now + 1).toISOString(),
        revision: 3,
      },
    ]);
    expect(result.applied).toBe(1);

    const rows = await getClient().execute({
      sql: "select count(*) as count from notes where board_id = ?",
      args: ["remote-note-board"],
    });
    expect(Number(rows.rows[0]?.count)).toBe(0);
  });

  it("queues only the task_image entity when an attachment is added", async () => {
    await prepareSync("remote-user-a");
    const { board, detail } = await makeBoard("Attachments");
    const task = await createTask(
      board.id,
      { columnId: detail.columns[0]!.id, title: "Has image" },
      LOCAL_USER_ID,
      test.db,
    );
    await getClient().execute("delete from sync_changes");

    const image = await addTaskImage(
      task.id,
      {
        dataURL: pngDataUrl(),
        name: "shot.png",
      },
      LOCAL_USER_ID,
      test.db,
      null,
    );

    const pending = await listPendingChanges(0, 500);
    expect(pending.map((change) => change.entityType)).toEqual(["task_image"]);
    expect(pending[0]).toMatchObject({
      entityId: image.id,
      data: {
        id: image.id,
        task_id: task.id,
        name: "shot.png",
        position: 0,
      },
    });
  });

  it("applies task_image entities and records their revisions", async () => {
    await prepareSync("remote-user-a");
    const { board, detail } = await makeBoard("Attachments");
    const task = await createTask(
      board.id,
      { columnId: detail.columns[0]!.id, title: "Has image" },
      LOCAL_USER_ID,
      test.db,
    );
    const now = Date.now();

    const result = await applyRemoteChanges(5, [
      {
        entityType: "task_image",
        entityId: "remote-image",
        deleted: false,
        data: {
          id: "remote-image",
          task_id: task.id,
          url: "/api/images/image-remote",
          name: "remote.png",
          position: 0,
          created_at: now,
          updated_at: now,
        },
        updatedAt: new Date(now).toISOString(),
        revision: 5,
      },
    ]);

    expect(result.applied).toBe(1);
    expect(result.skipped).toEqual([]);

    const images = await getClient().execute({
      sql: "select task_id, url, name from task_images where id = ?",
      args: ["remote-image"],
    });
    expect(images.rows[0]).toMatchObject({
      task_id: task.id,
      url: "/api/images/image-remote",
      name: "remote.png",
    });

    const revisions = await getClient().execute({
      sql: "select revision from sync_entity_revisions where entity_type = 'task_image' and entity_id = ?",
      args: ["remote-image"],
    });
    expect(Number(revisions.rows[0]?.revision)).toBe(5);
  });

  it("applies a task_image tombstone and deletes the attachment row", async () => {
    await prepareSync("remote-user-a");
    const { board, detail } = await makeBoard("Attachments");
    const task = await createTask(
      board.id,
      { columnId: detail.columns[0]!.id, title: "Has image" },
      LOCAL_USER_ID,
      test.db,
    );
    const now = Date.now();
    await applyRemoteChanges(1, [
      {
        entityType: "task_image",
        entityId: "remote-image",
        deleted: false,
        data: {
          id: "remote-image",
          task_id: task.id,
          url: "/api/images/image-remote",
          name: null,
          position: 0,
          created_at: now,
          updated_at: now,
        },
        updatedAt: new Date(now).toISOString(),
        revision: 1,
      },
    ]);

    const result = await applyRemoteChanges(2, [
      {
        entityType: "task_image",
        entityId: "remote-image",
        deleted: true,
        data: {},
        updatedAt: new Date(now + 1).toISOString(),
        revision: 2,
      },
    ]);
    expect(result.applied).toBe(1);

    const rows = await getClient().execute({
      sql: "select count(*) as count from task_images where id = ?",
      args: ["remote-image"],
    });
    expect(Number(rows.rows[0]?.count)).toBe(0);
  });

  it("skips a task_image whose parent task is missing", async () => {
    await prepareSync("remote-user-a");
    const now = Date.now();

    const result = await applyRemoteChanges(1, [
      {
        entityType: "task_image",
        entityId: "orphan-image",
        deleted: false,
        data: {
          id: "orphan-image",
          task_id: "missing-task",
          url: "/api/images/image-remote",
          name: null,
          position: 0,
          created_at: now,
          updated_at: now,
        },
        updatedAt: new Date(now).toISOString(),
        revision: 1,
      },
    ]);

    expect(result.applied).toBe(0);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        entityType: "task_image",
        entityId: "orphan-image",
        reason: "Parent task no longer exists",
      }),
    ]);
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

  it("promotes local children when a remote folder tombstone arrives", async () => {
    await prepareSync("remote-user-a");
    const { board } = await makeBoard("Folder host");
    const projectId = board.projectId!;
    const parent = await createFolder(
      { projectId, name: "Parent" },
      LOCAL_USER_ID,
      test.db,
    );
    const child = await createFolder(
      { projectId, parentId: parent.id, name: "Child" },
      LOCAL_USER_ID,
      test.db,
    );
    const nested = await createBoard(
      { name: "Nested space", projectId, folderId: parent.id },
      LOCAL_USER_ID,
      test.db,
    );
    await getClient().execute("delete from sync_changes");

    // Future timestamp guarantees the tombstone wins over the just-created
    // local rows regardless of same-millisecond clock ties.
    const result = await applyRemoteChanges(2, [
      {
        entityType: "folder",
        entityId: parent.id,
        deleted: true,
        data: {},
        updatedAt: new Date(Date.now() + 60_000).toISOString(),
        revision: 2,
      },
    ]);

    expect(result.applied).toBe(1);
    const remainingFolders = await test.db.select().from(folders);
    expect(remainingFolders.map((folder) => folder.id)).toEqual([child.id]);
    expect(remainingFolders[0]?.parentId).toBeNull();
    const [promoted] = await test.db
      .select()
      .from(boards)
      .where(eq(boards.id, nested.id));
    expect(promoted?.folderId).toBeNull();
    // Promotion updates happen with triggers suppressed; they must not echo.
    expect(await listPendingChanges(0, 500)).toHaveLength(0);
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
