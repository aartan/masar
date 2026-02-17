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
  counts: { subtaskCount: number; subtaskDoneCount: number; commentCount: number },
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
): Promise<BoardSummary[]> {
  const boardRows = await database
    .select()
    .from(boards)
    .orderBy(asc(boards.position), asc(boards.createdAt));

  if (boardRows.length === 0) return [];

  const [taskCounts, doneCounts, columnCounts] = await Promise.all([
    database
      .select({ boardId: tasks.boardId, value: count() })
      .from(tasks)
      .groupBy(tasks.boardId),
    database
      .select({ boardId: tasks.boardId, value: count() })
      .from(tasks)
      .innerJoin(columns, eq(tasks.columnId, columns.id))
      .where(eq(columns.isDone, true))
      .groupBy(tasks.boardId),
    database
      .select({ boardId: columns.boardId, value: count() })
      .from(columns)
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
): Promise<BoardSummary | null> {
  const [row] = await database
    .select()
    .from(boards)
    .where(eq(boards.id, boardId))
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
): Promise<BoardColumn[]> {
  const rows = await database
    .select()
    .from(columns)
    .where(eq(columns.boardId, boardId))
    .orderBy(asc(columns.position), asc(columns.createdAt));
  return rows.map(serializeColumn);
}

export async function fetchLabels(
  database: AppDatabase,
  boardId: string,
): Promise<Label[]> {
  const rows = await database
    .select()
    .from(labels)
    .where(eq(labels.boardId, boardId))
    .orderBy(asc(labels.createdAt));
  return rows.map(serializeLabel);
}

export async function fetchTasks(
  database: AppDatabase,
  options: { boardId?: string; taskId?: string } = {},
): Promise<Task[]> {
  const conditions = [];
  if (options.boardId) conditions.push(eq(tasks.boardId, options.boardId));
  if (options.taskId) conditions.push(eq(tasks.id, options.taskId));

  const rows = await database
    .select()
    .from(tasks)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
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
): Promise<BoardRow> {
  const [row] = await database
    .select()
    .from(boards)
    .where(eq(boards.id, boardId))
    .limit(1);
  if (!row) throw new ApiError("Board not found.", 404);
  return row;
}

export async function requireColumn(
  database: AppDatabase,
  columnId: string,
) {
  const [row] = await database
    .select()
    .from(columns)
    .where(eq(columns.id, columnId))
    .limit(1);
  if (!row) throw new ApiError("Column not found.", 404);
  return row;
}

export async function requireTask(
  database: AppDatabase,
  taskId: string,
): Promise<TaskRow> {
  const [row] = await database
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!row) throw new ApiError("Task not found.", 404);
  return row;
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
): Promise<number> {
  const [row] = await database
    .select({ value: sql<number>`coalesce(max(${boards.position}), -1)` })
    .from(boards);
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
