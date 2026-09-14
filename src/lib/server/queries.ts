import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

import type { AppDatabase } from "@/db";
import {
  boards,
  columns,
  comments,
  labels,
  subtasks,
  taskLabels,
  tasks,
  type BoardRow,
  type TaskRow,
} from "@/db/schema";
import { ApiError } from "@/lib/api";
import type { BoardColumn, BoardSummary, Label, Task } from "@/lib/types";
import type { BoardColor, LabelColor, Priority } from "@/lib/constants";

function ownedBoardIds(database: AppDatabase, ownerId: string) {
  return database
    .select({ id: boards.id })
    .from(boards)
    .where(eq(boards.ownerId, ownerId));
}

export function serializeBoard(
  row: BoardRow,
  counts: { taskCount: number; doneCount: number; columnCount: number },
): BoardSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color as BoardColor,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    taskCount: counts.taskCount,
    doneCount: counts.doneCount,
    columnCount: counts.columnCount,
  };
}

export function serializeColumn(row: {
  id: string;
  boardId: string;
  name: string;
  position: number;
  isDone: boolean;
  createdAt: Date;
  updatedAt: Date;
}): BoardColumn {
  return {
    id: row.id,
    boardId: row.boardId,
    name: row.name,
    position: row.position,
    isDone: row.isDone,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeLabel(row: {
  id: string;
  boardId: string;
  name: string;
  color: string;
  createdAt: Date;
}): Label {
  return {
    id: row.id,
    boardId: row.boardId,
    name: row.name,
    color: row.color as LabelColor,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeTask(
  row: TaskRow,
  labelIds: string[],
  counts: {
    subtaskCount: number;
    subtaskDoneCount: number;
    commentCount: number;
  },
): Task {
  return {
    id: row.id,
    boardId: row.boardId,
    columnId: row.columnId,
    title: row.title,
    description: row.description,
    priority: row.priority as Priority,
    dueDate: row.dueDate,
    assignee: row.assignee,
    position: row.position,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    labelIds,
    subtaskCount: counts.subtaskCount,
    subtaskDoneCount: counts.subtaskDoneCount,
    commentCount: counts.commentCount,
  };
}

export async function fetchBoardSummaries(
  database: AppDatabase,
  ownerId: string,
): Promise<BoardSummary[]> {
  const boardRows = await database
    .select()
    .from(boards)
    .where(eq(boards.ownerId, ownerId))
    .orderBy(asc(boards.position), asc(boards.createdAt));

  if (boardRows.length === 0) return [];
  const boardIds = boardRows.map((row) => row.id);

  const [taskCounts, doneCounts, columnCounts] = await Promise.all([
    database
      .select({ boardId: tasks.boardId, value: count() })
      .from(tasks)
      .where(inArray(tasks.boardId, boardIds))
      .groupBy(tasks.boardId),
    database
      .select({ boardId: tasks.boardId, value: count() })
      .from(tasks)
      .innerJoin(columns, eq(tasks.columnId, columns.id))
      .where(
        and(eq(columns.isDone, true), inArray(tasks.boardId, boardIds)),
      )
      .groupBy(tasks.boardId),
    database
      .select({ boardId: columns.boardId, value: count() })
      .from(columns)
      .where(inArray(columns.boardId, boardIds))
      .groupBy(columns.boardId),
  ]);

  const taskMap = new Map(taskCounts.map((row) => [row.boardId, row.value]));
  const doneMap = new Map(doneCounts.map((row) => [row.boardId, row.value]));
  const columnMap = new Map(columnCounts.map((row) => [row.boardId, row.value]));

  return boardRows.map((row) =>
    serializeBoard(row, {
      taskCount: taskMap.get(row.id) ?? 0,
      doneCount: doneMap.get(row.id) ?? 0,
      columnCount: columnMap.get(row.id) ?? 0,
    }),
  );
}

export async function fetchBoardSummary(
  database: AppDatabase,
  boardId: string,
  ownerId: string,
): Promise<BoardSummary | null> {
  const [row] = await database
    .select()
    .from(boards)
    .where(and(eq(boards.id, boardId), eq(boards.ownerId, ownerId)))
    .limit(1);
  if (!row) return null;

  const [[taskRow], [doneRow], [columnRow]] = await Promise.all([
    database
      .select({ value: count() })
      .from(tasks)
      .where(eq(tasks.boardId, boardId)),
    database
      .select({ value: count() })
      .from(tasks)
      .innerJoin(columns, eq(tasks.columnId, columns.id))
      .where(and(eq(tasks.boardId, boardId), eq(columns.isDone, true))),
    database
      .select({ value: count() })
      .from(columns)
      .where(eq(columns.boardId, boardId)),
  ]);

  return serializeBoard(row, {
    taskCount: taskRow?.value ?? 0,
    doneCount: doneRow?.value ?? 0,
    columnCount: columnRow?.value ?? 0,
  });
}

export async function fetchColumns(
  database: AppDatabase,
  boardId: string,
  ownerId: string,
): Promise<BoardColumn[]> {
  const rows = await database
    .select()
    .from(columns)
    .where(
      and(
        eq(columns.boardId, boardId),
        inArray(columns.boardId, ownedBoardIds(database, ownerId)),
      ),
    )
    .orderBy(asc(columns.position), asc(columns.createdAt));
  return rows.map(serializeColumn);
}

export async function fetchLabels(
  database: AppDatabase,
  boardId: string,
  ownerId: string,
): Promise<Label[]> {
  const rows = await database
    .select()
    .from(labels)
    .where(
      and(
        eq(labels.boardId, boardId),
        inArray(labels.boardId, ownedBoardIds(database, ownerId)),
      ),
    )
    .orderBy(asc(labels.createdAt));
  return rows.map(serializeLabel);
}

export async function fetchTasks(
  database: AppDatabase,
  options: { ownerId: string; boardId?: string; taskId?: string },
): Promise<Task[]> {
  const conditions = [
    inArray(tasks.boardId, ownedBoardIds(database, options.ownerId)),
  ];
  if (options.boardId) conditions.push(eq(tasks.boardId, options.boardId));
  if (options.taskId) conditions.push(eq(tasks.id, options.taskId));

  const rows = await database
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(asc(tasks.columnId), asc(tasks.position), asc(tasks.createdAt));

  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const [labelRows, subtaskRows, commentRows] = await Promise.all([
    database
      .select({ taskId: taskLabels.taskId, labelId: taskLabels.labelId })
      .from(taskLabels)
      .where(inArray(taskLabels.taskId, ids)),
    database
      .select({
        taskId: subtasks.taskId,
        total: count(),
        done: sql<number>`sum(case when ${subtasks.completed} = 1 then 1 else 0 end)`.mapWith(
          Number,
        ),
      })
      .from(subtasks)
      .where(inArray(subtasks.taskId, ids))
      .groupBy(subtasks.taskId),
    database
      .select({ taskId: comments.taskId, total: count() })
      .from(comments)
      .where(inArray(comments.taskId, ids))
      .groupBy(comments.taskId),
  ]);

  const labelsByTask = new Map<string, string[]>();
  for (const row of labelRows) {
    const list = labelsByTask.get(row.taskId) ?? [];
    list.push(row.labelId);
    labelsByTask.set(row.taskId, list);
  }
  const subtaskMap = new Map(subtaskRows.map((row) => [row.taskId, row]));
  const commentMap = new Map(commentRows.map((row) => [row.taskId, row.total]));

  return rows.map((row) => {
    const subtask = subtaskMap.get(row.id);
    return serializeTask(row, labelsByTask.get(row.id) ?? [], {
      subtaskCount: subtask?.total ?? 0,
      subtaskDoneCount: subtask?.done ?? 0,
      commentCount: commentMap.get(row.id) ?? 0,
    });
  });
}

export async function requireBoard(
  database: AppDatabase,
  boardId: string,
  ownerId: string,
): Promise<BoardRow> {
  const [row] = await database
    .select()
    .from(boards)
    .where(and(eq(boards.id, boardId), eq(boards.ownerId, ownerId)))
    .limit(1);
  if (!row) throw new ApiError("Board not found.", 404);
  return row;
}

export async function requireColumn(
  database: AppDatabase,
  columnId: string,
  ownerId: string,
) {
  const [row] = await database
    .select({ column: columns })
    .from(columns)
    .innerJoin(boards, eq(columns.boardId, boards.id))
    .where(and(eq(columns.id, columnId), eq(boards.ownerId, ownerId)))
    .limit(1);
  if (!row) throw new ApiError("Column not found.", 404);
  return row.column;
}

export async function requireTask(
  database: AppDatabase,
  taskId: string,
  ownerId: string,
): Promise<TaskRow> {
  const [row] = await database
    .select({ task: tasks })
    .from(tasks)
    .innerJoin(boards, eq(tasks.boardId, boards.id))
    .where(and(eq(tasks.id, taskId), eq(boards.ownerId, ownerId)))
    .limit(1);
  if (!row) throw new ApiError("Task not found.", 404);
  return row.task;
}

export async function requireLabel(
  database: AppDatabase,
  labelId: string,
  ownerId: string,
) {
  const [row] = await database
    .select({ label: labels })
    .from(labels)
    .innerJoin(boards, eq(labels.boardId, boards.id))
    .where(and(eq(labels.id, labelId), eq(boards.ownerId, ownerId)))
    .limit(1);
  if (!row) throw new ApiError("Label not found.", 404);
  return row.label;
}

export async function requireSubtask(
  database: AppDatabase,
  subtaskId: string,
  ownerId: string,
) {
  const [row] = await database
    .select({ subtask: subtasks })
    .from(subtasks)
    .innerJoin(tasks, eq(subtasks.taskId, tasks.id))
    .innerJoin(boards, eq(tasks.boardId, boards.id))
    .where(and(eq(subtasks.id, subtaskId), eq(boards.ownerId, ownerId)))
    .limit(1);
  if (!row) throw new ApiError("Subtask not found.", 404);
  return row.subtask;
}

export async function requireComment(
  database: AppDatabase,
  commentId: string,
  ownerId: string,
) {
  const [row] = await database
    .select({ comment: comments })
    .from(comments)
    .innerJoin(tasks, eq(comments.taskId, tasks.id))
    .innerJoin(boards, eq(tasks.boardId, boards.id))
    .where(and(eq(comments.id, commentId), eq(boards.ownerId, ownerId)))
    .limit(1);
  if (!row) throw new ApiError("Comment not found.", 404);
  return row.comment;
}

export function isUniqueConstraintError(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (
      current instanceof Error &&
      /unique constraint failed/i.test(current.message)
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

export async function nextTaskPosition(
  database: AppDatabase,
  columnId: string,
): Promise<number> {
  const [row] = await database
    .select({ value: sql<number>`coalesce(max(${tasks.position}), -1)` })
    .from(tasks)
    .where(eq(tasks.columnId, columnId));
  return (row?.value ?? -1) + 1;
}

export async function nextColumnPosition(
  database: AppDatabase,
  boardId: string,
): Promise<number> {
  const [row] = await database
    .select({ value: sql<number>`coalesce(max(${columns.position}), -1)` })
    .from(columns)
    .where(eq(columns.boardId, boardId));
  return (row?.value ?? -1) + 1;
}

export async function nextBoardPosition(
  database: AppDatabase,
  ownerId: string,
): Promise<number> {
  const [row] = await database
    .select({ value: sql<number>`coalesce(max(${boards.position}), -1)` })
    .from(boards)
    .where(eq(boards.ownerId, ownerId));
  return (row?.value ?? -1) + 1;
}

export async function assertLabelsBelongToBoard(
  database: AppDatabase,
  boardId: string,
  labelIds: string[],
): Promise<string[]> {
  const unique = Array.from(new Set(labelIds));
  if (unique.length === 0) return [];
  const rows = await database
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.boardId, boardId), inArray(labels.id, unique)));
  if (rows.length !== unique.length) {
    throw new ApiError("One or more labels do not belong to this board.", 400);
  }
  return unique;
}
