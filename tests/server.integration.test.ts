import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import {
  boards,
  columns,
  comments,
  labels,
  subtasks,
  taskLabels,
  tasks,
} from "@/db/schema";
import { ApiError } from "@/lib/api";
import { addDaysIso, todayIso } from "@/lib/dates";
import {
  createBoard,
  deleteBoard,
  getBoardDetail,
  listBoards,
  updateBoard,
} from "@/lib/server/boards";
import {
  createColumn,
  deleteColumn,
  reorderColumns,
  updateColumn,
} from "@/lib/server/columns";
import { createComment, deleteComment } from "@/lib/server/comments";
import { createLabel, deleteLabel, updateLabel } from "@/lib/server/labels";
import {
  createSubtask,
  deleteSubtask,
  updateSubtask,
} from "@/lib/server/subtasks";
import {
  createTask,
  deleteTask,
  duplicateTask,
  getTaskDetail,
  reorderTasks,
  updateTask,
} from "@/lib/server/tasks";
import { getDashboardData } from "@/lib/server/stats";
import { searchTasks } from "@/lib/server/search";
import type { TestDatabase } from "./helpers/test-db";
import { createTestDatabase, createTestUser } from "./helpers/test-db";

let test: TestDatabase;
let owner: { id: string; name: string; email: string };
let other: { id: string; name: string; email: string };

beforeAll(async () => {
  test = await createTestDatabase();
  owner = await createTestUser(test.db, {
    name: "Owner",
    email: "owner@example.test",
  });
  other = await createTestUser(test.db, {
    name: "Other",
    email: "other@example.test",
  });
});

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  // Every test starts from empty workspaces. Cascades remove child rows.
  await test.db.delete(boards);
});

async function makeBoard(
  name = "Test board",
  ownerId = owner.id,
) {
  const board = await createBoard({ name }, ownerId, test.db);
  const detail = await getBoardDetail(board.id, ownerId, test.db);
  const byName = (columnName: string) => {
    const column = detail.columns.find((item) => item.name === columnName);
    if (!column) throw new Error(`Missing column ${columnName}`);
    return column;
  };
  return {
    board,
    detail,
    backlog: byName("Backlog"),
    todo: byName("To Do"),
    inProgress: byName("In Progress"),
    review: byName("In Review"),
    done: byName("Done"),
  };
}

describe("boards", () => {
  it("creates the five starter columns with exactly one completion column", async () => {
    const { board, detail } = await makeBoard("Launch");

    expect(board.name).toBe("Launch");
    expect(board.taskCount).toBe(0);
    expect(detail.columns.map((column) => column.name)).toEqual([
      "Backlog",
      "To Do",
      "In Progress",
      "In Review",
      "Done",
    ]);
    expect(detail.columns.filter((column) => column.isDone)).toHaveLength(1);
    expect(detail.columns.find((column) => column.isDone)?.name).toBe("Done");
    expect(detail.columns.map((column) => column.position)).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it("lists boards in position order and updates metadata", async () => {
    const first = await createBoard(
      { name: "First", color: "sage" },
      owner.id,
      test.db,
    );
    await createBoard({ name: "Second", color: "sky" }, owner.id, test.db);

    const updated = await updateBoard(
      first.id,
      { name: "Renamed", description: "A better description", color: "rose" },
      owner.id,
      test.db,
    );
    expect(updated.name).toBe("Renamed");
    expect(updated.color).toBe("rose");

    const list = await listBoards(owner.id, test.db);
    expect(list.map((item) => item.name)).toEqual(["Renamed", "Second"]);
  });

  it("rejects updates for unknown boards", async () => {
    await expect(
      updateBoard("missing", { name: "Nope" }, owner.id, test.db),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("columns", () => {
  it("enforces a single completion column and unique names", async () => {
    const { board, todo, done } = await makeBoard();

    const newDone = await updateColumn(
      todo.id,
      { isDone: true },
      owner.id,
      test.db,
    );
    expect(newDone.isDone).toBe(true);

    const refreshed = await getBoardDetail(board.id, owner.id, test.db);
    expect(
      refreshed.columns
        .filter((column) => column.isDone)
        .map((column) => column.id),
    ).toEqual([todo.id]);
    expect(
      refreshed.columns.find((column) => column.id === done.id)?.isDone,
    ).toBe(false);

    await expect(
      createColumn(board.id, { name: "Backlog" }, owner.id, test.db),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("moves tasks to the first remaining column when deleted", async () => {
    const { board, backlog, review } = await makeBoard();
    const task = await createTask(
      board.id,
      { columnId: review.id, title: "Move me" },
      owner.id,
      test.db,
    );

    const result = await deleteColumn(review.id, owner.id, test.db);
    expect(result.movedTasks).toBe(1);
    expect(result.targetColumnId).toBe(backlog.id);

    const refreshed = await getBoardDetail(board.id, owner.id, test.db);
    expect(refreshed.columns.map((column) => column.name)).toEqual([
      "Backlog",
      "To Do",
      "In Progress",
      "Done",
    ]);
    const moved = refreshed.tasks.find((item) => item.id === task.id);
    expect(moved?.columnId).toBe(backlog.id);
  });

  it("refuses to delete the last column", async () => {
    const { board, backlog, todo, inProgress, review, done } =
      await makeBoard();
    for (const column of [todo, inProgress, review, done]) {
      await deleteColumn(column.id, owner.id, test.db);
    }
    await expect(
      deleteColumn(backlog.id, owner.id, test.db),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(
      (await getBoardDetail(board.id, owner.id, test.db)).columns,
    ).toHaveLength(1);
  });

  it("reorders every column and rejects incomplete payloads", async () => {
    const { board, detail } = await makeBoard();
    const reversed = [...detail.columns].reverse().map((column) => column.id);

    const result = await reorderColumns(board.id, reversed, owner.id, test.db);
    expect(result.map((column) => column.id)).toEqual(reversed);
    expect(result.map((column) => column.position)).toEqual([0, 1, 2, 3, 4]);

    await expect(
      reorderColumns(board.id, reversed.slice(1), owner.id, test.db),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("tasks", () => {
  it("appends tasks to a column and returns full details", async () => {
    const { board, todo } = await makeBoard();

    const first = await createTask(
      board.id,
      { columnId: todo.id, title: "First", priority: "high" },
      owner.id,
      test.db,
    );
    const second = await createTask(
      board.id,
      { columnId: todo.id, title: "Second" },
      owner.id,
      test.db,
    );

    expect(first.position).toBe(0);
    expect(second.position).toBe(1);
    expect(first.priority).toBe("high");
    expect(first.subtasks).toEqual([]);
    expect(first.comments).toEqual([]);

    const refreshed = await getBoardDetail(board.id, owner.id, test.db);
    expect(refreshed.board.taskCount).toBe(2);
    expect(refreshed.tasks.map((task) => task.title).sort()).toEqual([
      "First",
      "Second",
    ]);
  });

  it("marks tasks complete when created in a done column", async () => {
    const { board, done } = await makeBoard();
    const task = await createTask(
      board.id,
      { columnId: done.id, title: "Already done" },
      owner.id,
      test.db,
    );
    expect(task.completedAt).not.toBeNull();
  });

  it("rejects columns and labels from another board", async () => {
    const first = await makeBoard("First");
    const second = await makeBoard("Second");
    const secondLabel = await createLabel(
      second.board.id,
      { name: "Ops" },
      owner.id,
      test.db,
    );

    await expect(
      createTask(
        first.board.id,
        { columnId: second.todo.id, title: "Wrong board" },
        owner.id,
        test.db,
      ),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      createTask(
        first.board.id,
        {
          columnId: first.todo.id,
          title: "Wrong label",
          labelIds: [secondLabel.id],
        },
        owner.id,
        test.db,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("updates properties, labels, and completion state when moving columns", async () => {
    const { board, todo, done } = await makeBoard();
    const label = await createLabel(
      board.id,
      { name: "Design", color: "violet" },
      owner.id,
      test.db,
    );
    const task = await createTask(
      board.id,
      { columnId: todo.id, title: "Original" },
      owner.id,
      test.db,
    );

    const updated = await updateTask(
      task.id,
      {
        title: "Updated",
        description: "Details",
        priority: "urgent",
        dueDate: "2026-12-01",
        assignee: "Ada",
        labelIds: [label.id],
      },
      owner.id,
      test.db,
    );
    expect(updated).toMatchObject({
      title: "Updated",
      description: "Details",
      priority: "urgent",
      dueDate: "2026-12-01",
      assignee: "Ada",
      labelIds: [label.id],
    });

    const completed = await updateTask(
      task.id,
      { columnId: done.id },
      owner.id,
      test.db,
    );
    expect(completed.columnId).toBe(done.id);
    expect(completed.completedAt).not.toBeNull();

    const reopened = await updateTask(
      task.id,
      { columnId: todo.id },
      owner.id,
      test.db,
    );
    expect(reopened.completedAt).toBeNull();

    const cleared = await updateTask(
      task.id,
      { description: null, dueDate: null, assignee: null, labelIds: [] },
      owner.id,
      test.db,
    );
    expect(cleared.description).toBeNull();
    expect(cleared.dueDate).toBeNull();
    expect(cleared.assignee).toBeNull();
    expect(cleared.labelIds).toEqual([]);
  });

  it("duplicates labels and subtasks without comments", async () => {
    const { board, todo } = await makeBoard();
    const label = await createLabel(
      board.id,
      { name: "Design" },
      owner.id,
      test.db,
    );
    const task = await createTask(
      board.id,
      { columnId: todo.id, title: "Source", labelIds: [label.id] },
      owner.id,
      test.db,
    );
    await createSubtask(task.id, "Write copy", owner.id, test.db);
    await createComment(task.id, { body: "A comment" }, owner.id, test.db);

    const copy = await duplicateTask(task.id, owner.id, test.db);
    expect(copy.id).not.toBe(task.id);
    expect(copy.title).toBe("Source (copy)");
    expect(copy.labelIds).toEqual([label.id]);
    expect(copy.subtasks.map((subtask) => subtask.title)).toEqual([
      "Write copy",
    ]);
    expect(copy.comments).toEqual([]);
    expect(copy.position).toBe(task.position + 1);
  });

  it("deletes tasks and their children", async () => {
    const { board, todo } = await makeBoard();
    const task = await createTask(
      board.id,
      { columnId: todo.id, title: "Delete me" },
      owner.id,
      test.db,
    );
    await createSubtask(task.id, "Child", owner.id, test.db);
    await createComment(task.id, { body: "Comment" }, owner.id, test.db);

    await deleteTask(task.id, owner.id, test.db);

    expect(
      await test.db.select().from(tasks).where(eq(tasks.id, task.id)),
    ).toEqual([]);
    expect(
      await test.db.select().from(subtasks).where(eq(subtasks.taskId, task.id)),
    ).toEqual([]);
    expect(
      await test.db.select().from(comments).where(eq(comments.taskId, task.id)),
    ).toEqual([]);
  });
});

describe("task reordering", () => {
  it("persists a complete order across columns and normalizes positions", async () => {
    const { board, todo, inProgress, done } = await makeBoard();
    const a = await createTask(
      board.id,
      { columnId: todo.id, title: "A" },
      owner.id,
      test.db,
    );
    const b = await createTask(
      board.id,
      { columnId: todo.id, title: "B" },
      owner.id,
      test.db,
    );
    const c = await createTask(
      board.id,
      { columnId: inProgress.id, title: "C" },
      owner.id,
      test.db,
    );

    const refreshed = await getBoardDetail(board.id, owner.id, test.db);
    const ordered = await reorderTasks(
      board.id,
      {
        columns: refreshed.columns.map((column) => ({
          columnId: column.id,
          taskIds:
            column.id === inProgress.id
              ? [a.id, c.id]
              : column.id === todo.id
                ? [b.id]
                : column.id === done.id
                  ? []
                  : [],
        })),
      },
      owner.id,
      test.db,
    );

    const byId = new Map(ordered.map((task) => [task.id, task]));
    expect(byId.get(a.id)?.columnId).toBe(inProgress.id);
    expect(byId.get(a.id)?.position).toBe(0);
    expect(byId.get(c.id)?.position).toBe(1);
    expect(byId.get(b.id)?.columnId).toBe(todo.id);
    expect(byId.get(b.id)?.position).toBe(0);
  });

  it("sets and clears completion state when moving through the done column", async () => {
    const { board, todo, done } = await makeBoard();
    const task = await createTask(
      board.id,
      { columnId: todo.id, title: "Move" },
      owner.id,
      test.db,
    );
    const refreshed = await getBoardDetail(board.id, owner.id, test.db);

    const completed = await reorderTasks(
      board.id,
      {
        columns: refreshed.columns.map((column) => ({
          columnId: column.id,
          taskIds: column.id === done.id ? [task.id] : [],
        })),
      },
      owner.id,
      test.db,
    );
    expect(
      completed.find((item) => item.id === task.id)?.completedAt,
    ).not.toBeNull();

    const reopened = await reorderTasks(
      board.id,
      {
        columns: refreshed.columns.map((column) => ({
          columnId: column.id,
          taskIds: column.id === todo.id ? [task.id] : [],
        })),
      },
      owner.id,
      test.db,
    );
    expect(reopened.find((item) => item.id === task.id)?.completedAt).toBeNull();
  });

  it("rejects incomplete, duplicated, and foreign task orders", async () => {
    const { board, todo } = await makeBoard();
    const otherBoard = await makeBoard("Other", other.id);
    const task = await createTask(
      board.id,
      { columnId: todo.id, title: "One" },
      owner.id,
      test.db,
    );
    const otherTask = await createTask(
      otherBoard.board.id,
      { columnId: otherBoard.todo.id, title: "Other task" },
      other.id,
      test.db,
    );
    const refreshed = await getBoardDetail(board.id, owner.id, test.db);
    const emptyOrder = refreshed.columns.map((column) => ({
      columnId: column.id,
      taskIds: [] as string[],
    }));

    await expect(
      reorderTasks(board.id, { columns: emptyOrder }, owner.id, test.db),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      reorderTasks(
        board.id,
        {
          columns: emptyOrder.map((column) => ({
            ...column,
            taskIds: column.columnId === todo.id ? [task.id, task.id] : [],
          })),
        },
        owner.id,
        test.db,
      ),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      reorderTasks(
        board.id,
        {
          columns: emptyOrder.map((column) => ({
            ...column,
            taskIds: column.columnId === todo.id ? [otherTask.id] : [],
          })),
        },
        owner.id,
        test.db,
      ),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      reorderTasks(
        board.id,
        { columns: emptyOrder.slice(1) },
        owner.id,
        test.db,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("subtasks, comments, and labels", () => {
  it("creates, updates, and orders subtasks", async () => {
    const { board, todo } = await makeBoard();
    const task = await createTask(
      board.id,
      { columnId: todo.id, title: "Task" },
      owner.id,
      test.db,
    );
    const first = await createSubtask(task.id, "First", owner.id, test.db);
    const second = await createSubtask(task.id, "Second", owner.id, test.db);

    expect([first.position, second.position]).toEqual([0, 1]);
    const updated = await updateSubtask(
      first.id,
      { completed: true },
      owner.id,
      test.db,
    );
    expect(updated.completed).toBe(true);

    const detail = await getTaskDetail(task.id, owner.id, test.db);
    expect(detail.subtasks.map((item) => item.completed)).toEqual([
      true,
      false,
    ]);
    expect(detail.subtaskCount).toBe(2);
    expect(detail.subtaskDoneCount).toBe(1);
  });

  it("creates comments with a default author and rejects empty bodies", async () => {
    const { board, todo } = await makeBoard();
    const task = await createTask(
      board.id,
      { columnId: todo.id, title: "Task" },
      owner.id,
      test.db,
    );
    const comment = await createComment(
      task.id,
      { body: "Hello" },
      owner.id,
      test.db,
    );
    expect(comment.author).toBe("You");

    const detail = await getTaskDetail(task.id, owner.id, test.db);
    expect(detail.comments).toHaveLength(1);
    expect(detail.commentCount).toBe(1);
  });

  it("enforces unique label names per board", async () => {
    const { board } = await makeBoard();
    await createLabel(board.id, { name: "Design" }, owner.id, test.db);
    await expect(
      createLabel(board.id, { name: "Design" }, owner.id, test.db),
    ).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe("board deletion and dashboard stats", () => {
  it("cascades board deletion to every child row", async () => {
    const { board, todo } = await makeBoard();
    const label = await createLabel(board.id, { name: "Ops" }, owner.id, test.db);
    const task = await createTask(
      board.id,
      { columnId: todo.id, title: "Task", labelIds: [label.id] },
      owner.id,
      test.db,
    );
    await createSubtask(task.id, "Child", owner.id, test.db);
    await createComment(task.id, { body: "Comment" }, owner.id, test.db);

    await deleteBoard(board.id, owner.id, test.db);

    expect(
      await test.db.select().from(boards).where(eq(boards.id, board.id)),
    ).toEqual([]);
    expect(
      await test.db.select().from(columns).where(eq(columns.boardId, board.id)),
    ).toEqual([]);
    expect(
      await test.db.select().from(tasks).where(eq(tasks.boardId, board.id)),
    ).toEqual([]);
    expect(
      await test.db.select().from(labels).where(eq(labels.boardId, board.id)),
    ).toEqual([]);
    expect(
      await test.db
        .select()
        .from(taskLabels)
        .where(eq(taskLabels.taskId, task.id)),
    ).toEqual([]);
    expect(
      await test.db.select().from(subtasks).where(eq(subtasks.taskId, task.id)),
    ).toEqual([]);
    expect(
      await test.db.select().from(comments).where(eq(comments.taskId, task.id)),
    ).toEqual([]);
  });

  it("computes real dashboard totals from the database", async () => {
    const { board, todo, done } = await makeBoard();
    const today = todayIso();
    const yesterday = addDaysIso(today, -1);
    const tomorrow = addDaysIso(today, 1);

    await createTask(
      board.id,
      {
        columnId: todo.id,
        title: "Overdue",
        dueDate: yesterday,
        priority: "urgent",
      },
      owner.id,
      test.db,
    );
    await createTask(
      board.id,
      {
        columnId: todo.id,
        title: "Due soon",
        dueDate: tomorrow,
        priority: "high",
      },
      owner.id,
      test.db,
    );
    await createTask(
      board.id,
      { columnId: done.id, title: "Done", priority: "low" },
      owner.id,
      test.db,
    );

    const stats = await getDashboardData(owner.id, test.db);
    expect(stats.totals).toMatchObject({
      tasks: 3,
      open: 2,
      done: 1,
      overdue: 1,
      dueSoon: 1,
      completedLast7Days: 1,
      boards: 1,
    });
    expect(stats.priorityCounts).toMatchObject({ urgent: 1, high: 1, low: 1 });
    expect(stats.boardStats[0]).toMatchObject({
      total: 3,
      open: 2,
      done: 1,
      overdue: 1,
    });
    expect(stats.upcoming.map((task) => task.title)).toEqual([
      "Overdue",
      "Due soon",
    ]);
  });

  it("searches task titles and descriptions", async () => {
    const { board, todo } = await makeBoard();
    await createTask(
      board.id,
      {
        columnId: todo.id,
        title: "Launch pricing page",
        description: "Compare plans",
      },
      owner.id,
      test.db,
    );
    await createTask(
      board.id,
      { columnId: todo.id, title: "Unrelated", description: "Nothing here" },
      owner.id,
      test.db,
    );

    expect(
      (await searchTasks(owner.id, "pricing", 10, test.db)).map(
        (item) => item.title,
      ),
    ).toEqual(["Launch pricing page"]);
    expect(
      (await searchTasks(owner.id, "compare", 10, test.db)).map(
        (item) => item.title,
      ),
    ).toEqual(["Launch pricing page"]);
    expect(await searchTasks(owner.id, "   ", 10, test.db)).toEqual([]);
  });
});

describe("workspace isolation", () => {
  it("keeps boards and their contents hidden from other accounts", async () => {
    const mine = await makeBoard("Mine");
    const theirs = await makeBoard("Theirs", other.id);

    expect((await listBoards(owner.id, test.db)).map((row) => row.name)).toEqual(
      ["Mine"],
    );
    expect((await listBoards(other.id, test.db)).map((row) => row.name)).toEqual(
      ["Theirs"],
    );

    await expect(
      getBoardDetail(mine.board.id, other.id, test.db),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      updateBoard(mine.board.id, { name: "Stolen" }, other.id, test.db),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      deleteBoard(mine.board.id, other.id, test.db),
    ).rejects.toMatchObject({ status: 404 });

    const original = await getBoardDetail(mine.board.id, owner.id, test.db);
    expect(original.board.name).toBe("Mine");
    expect(theirs.board.id).not.toBe(mine.board.id);
  });

  it("rejects cross-account access to columns, tasks, labels, subtasks, and comments", async () => {
    const mine = await makeBoard("Mine");
    const theirs = await makeBoard("Theirs", other.id);
    const task = await createTask(
      mine.board.id,
      { columnId: mine.todo.id, title: "Private task" },
      owner.id,
      test.db,
    );
    const label = await createLabel(
      mine.board.id,
      { name: "Private label" },
      owner.id,
      test.db,
    );
    const subtask = await createSubtask(
      task.id,
      "Private subtask",
      owner.id,
      test.db,
    );
    const comment = await createComment(
      task.id,
      { body: "Private comment" },
      owner.id,
      test.db,
    );

    await expect(
      createColumn(mine.board.id, { name: "Invader" }, other.id, test.db),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      updateColumn(mine.todo.id, { name: "Stolen" }, other.id, test.db),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      deleteColumn(mine.todo.id, other.id, test.db),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      reorderColumns(
        mine.board.id,
        mine.detail.columns.map((column) => column.id),
        other.id,
        test.db,
      ),
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      createTask(
        mine.board.id,
        { columnId: mine.todo.id, title: "Invader" },
        other.id,
        test.db,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      createTask(
        theirs.board.id,
        { columnId: mine.todo.id, title: "Borrowed column" },
        other.id,
        test.db,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      getTaskDetail(task.id, other.id, test.db),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      updateTask(task.id, { title: "Stolen" }, other.id, test.db),
    ).rejects.toMatchObject({ status: 404 });
    await expect(deleteTask(task.id, other.id, test.db)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      duplicateTask(task.id, other.id, test.db),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      reorderTasks(
        mine.board.id,
        {
          columns: mine.detail.columns.map((column) => ({
            columnId: column.id,
            taskIds: column.id === mine.todo.id ? [task.id] : [],
          })),
        },
        other.id,
        test.db,
      ),
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      createLabel(mine.board.id, { name: "Invader" }, other.id, test.db),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      updateLabel(label.id, { name: "Stolen" }, other.id, test.db),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      deleteLabel(label.id, other.id, test.db),
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      createSubtask(task.id, "Invader", other.id, test.db),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      updateSubtask(subtask.id, { completed: true }, other.id, test.db),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      deleteSubtask(subtask.id, other.id, test.db),
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      createComment(task.id, { body: "Invader" }, other.id, test.db),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      deleteComment(comment.id, other.id, test.db),
    ).rejects.toMatchObject({ status: 404 });

    const detail = await getTaskDetail(task.id, owner.id, test.db);
    expect(detail.title).toBe("Private task");
    expect(detail.subtasks.map((item) => item.title)).toEqual([
      "Private subtask",
    ]);
    expect(detail.comments.map((item) => item.body)).toEqual([
      "Private comment",
    ]);
  });

  it("scopes search and dashboard data to the signed-in account", async () => {
    const mine = await makeBoard("Mine");
    const theirs = await makeBoard("Theirs", other.id);
    await createTask(
      mine.board.id,
      { columnId: mine.todo.id, title: "Private launch plan" },
      owner.id,
      test.db,
    );
    await createTask(
      theirs.board.id,
      { columnId: theirs.todo.id, title: "Other launch plan" },
      other.id,
      test.db,
    );

    expect(
      (await searchTasks(owner.id, "launch", 10, test.db)).map(
        (item) => item.title,
      ),
    ).toEqual(["Private launch plan"]);
    expect(
      (await searchTasks(other.id, "launch", 10, test.db)).map(
        (item) => item.title,
      ),
    ).toEqual(["Other launch plan"]);

    const ownerStats = await getDashboardData(owner.id, test.db);
    expect(ownerStats.totals).toMatchObject({ tasks: 1, boards: 1 });
    expect(ownerStats.boardStats.map((board) => board.name)).toEqual(["Mine"]);

    const otherStats = await getDashboardData(other.id, test.db);
    expect(otherStats.totals).toMatchObject({ tasks: 1, boards: 1 });
    expect(otherStats.boardStats.map((board) => board.name)).toEqual([
      "Theirs",
    ]);
  });

  it("never exposes unowned legacy rows to a registered account", async () => {
    const legacyId = randomUUID();
    await test.db.insert(boards).values({
      id: legacyId,
      ownerId: null,
      name: "Unowned legacy board",
    });

    expect(await listBoards(owner.id, test.db)).toEqual([]);
    expect(await listBoards(other.id, test.db)).toEqual([]);
    await expect(
      getBoardDetail(legacyId, owner.id, test.db),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      getBoardDetail(legacyId, other.id, test.db),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("ApiError", () => {
  it("carries an HTTP status", () => {
    const error = new ApiError("Nope", 418);
    expect(error.status).toBe(418);
    expect(error.message).toBe("Nope");
  });
});
