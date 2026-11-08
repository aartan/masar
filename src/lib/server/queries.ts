import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

import type { AppDatabase } from "@/db";
import {
  boards,
  columns,
  comments,
  labels,
  projects,
  subtasks,
  taskLabels,
  tasks,
  type BoardRow,
  type ProjectRow,
  type TaskRow,
} from "@/db/schema";
import { ApiError } from "@/lib/api";
import type {
  BoardColumn,
  BoardSummary,
  Label,
  ProjectSummary,
  Task,
} from "@/lib/types";
import type { BoardColor, BoardType, LabelColor, Priority } from "@/lib/constants";

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
    projectId: row.projectId,
    type: row.type as BoardType,
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

export function serializeProject(
  row: ProjectRow,
  counts: {
    boardCount: number;
    kanbanCount: number;
    whiteboardCount: number;
    noteCount: number;
    taskCount: number;
    doneCount: number;
  },
): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    position: row.position,
    archived: row.archived,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    boardCount: counts.boardCount,
    kanbanCount: counts.kanbanCount,
    whiteboardCount: counts.whiteboardCount,
    noteCount: counts.noteCount,
    taskCount: counts.taskCount,
    doneCount: counts.doneCount,
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
  if (!row) throw new ApiError("Space not found.", 404);
  return row;
}

export async function requireProject(
  database: AppDatabase,
  projectId: string,
  ownerId: string,
): Promise<ProjectRow> {
  const [row] = await database
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)))
    .limit(1);
  if (!row) throw new ApiError("Project not found.", 404);
  return row;
}

/**
 * Archiving a project makes its contents read-only. Mutations to a board,
 * column, task, label or whiteboard first resolve the owning project and call
 * this; a 409 is returned so the UI can explain why the edit was blocked.
 */
export function assertProjectWritable(project: ProjectRow): void {
  if (project.archived) {
    throw new ApiError(
      "This project is archived. Restore it to make changes.",
      409,
    );
  }
}

/** Reject content mutations when the board's project is archived. */
export async function assertBoardWritable(
  database: AppDatabase,
  boardId: string,
  ownerId: string,
): Promise<BoardRow> {
  const board = await requireBoard(database, boardId, ownerId);
  if (board.projectId) {
    const project = await requireProject(database, board.projectId, ownerId);
    assertProjectWritable(project);
  }
  return board;
}

export async function assertTaskWritable(
  database: AppDatabase,
  taskId: string,
  ownerId: string,
): Promise<TaskRow> {
  const task = await requireTask(database, taskId, ownerId);
  await assertBoardWritable(database, task.boardId, ownerId);
  return task;
}

export async function assertSubtaskWritable(
  database: AppDatabase,
  subtaskId: string,
  ownerId: string,
) {
  const subtask = await requireSubtask(database, subtaskId, ownerId);
  await assertTaskWritable(database, subtask.taskId, ownerId);
  return subtask;
}

export async function assertCommentWritable(
  database: AppDatabase,
  commentId: string,
  ownerId: string,
) {
  const comment = await requireComment(database, commentId, ownerId);
  await assertTaskWritable(database, comment.taskId, ownerId);
  return comment;
}

export async function fetchProjectSummaries(
  database: AppDatabase,
  ownerId: string,
): Promise<ProjectSummary[]> {
  const projectRows = await database
    .select()
    .from(projects)
    .where(eq(projects.ownerId, ownerId))
    .orderBy(asc(projects.position), asc(projects.createdAt));
  if (projectRows.length === 0) return [];

  const boardRows = await database
    .select({
      id: boards.id,
      projectId: boards.projectId,
      type: boards.type,
    })
    .from(boards)
    .where(eq(boards.ownerId, ownerId));

  const projectCounts = new Map<
    string,
    {
      boardCount: number;
      kanbanCount: number;
      whiteboardCount: number;
      noteCount: number;
      taskCount: number;
      doneCount: number;
    }
  >();
  for (const board of boardRows) {
    if (!board.projectId) continue;
    const current = projectCounts.get(board.projectId) ?? {
      boardCount: 0,
      kanbanCount: 0,
      whiteboardCount: 0,
      noteCount: 0,
      taskCount: 0,
      doneCount: 0,
    };
    current.boardCount += 1;
    if (board.type === "whiteboard") current.whiteboardCount += 1;
    else if (board.type === "note") current.noteCount += 1;
    else current.kanbanCount += 1;
    projectCounts.set(board.projectId, current);
  }

  if (boardRows.length > 0) {
    const taskRows = await database
      .select({
        boardId: tasks.boardId,
        total: count(),
        done: sql<number>`sum(case when ${columns.isDone} = 1 then 1 else 0 end)`.mapWith(
          Number,
        ),
      })
      .from(tasks)
      .innerJoin(columns, eq(tasks.columnId, columns.id))
      .where(inArray(tasks.boardId, boardRows.map((board) => board.id)))
      .groupBy(tasks.boardId);

    const boardProject = new Map(
      boardRows.map((board) => [board.id, board.projectId]),
    );
    for (const row of taskRows) {
      const projectId = boardProject.get(row.boardId);
      if (!projectId) continue;
      const current = projectCounts.get(projectId);
      if (!current) continue;
      current.taskCount += Number(row.total);
      current.doneCount += Number(row.done ?? 0);
    }
  }

  return projectRows.map((row) =>
    serializeProject(
      row,
      projectCounts.get(row.id) ?? {
        boardCount: 0,
        kanbanCount: 0,
        whiteboardCount: 0,
        noteCount: 0,
        taskCount: 0,
        doneCount: 0,
      },
    ),
  );
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

export async function nextProjectPosition(
  database: AppDatabase,
  ownerId: string,
): Promise<number> {
  const [row] = await database
    .select({ value: sql<number>`coalesce(max(${projects.position}), -1)` })
    .from(projects)
    .where(eq(projects.ownerId, ownerId));
  return (row?.value ?? -1) + 1;
}

/** Position of the next board within a specific project, for scoped reorder. */
export async function nextBoardPositionInProject(
  database: AppDatabase,
  projectId: string,
): Promise<number> {
  const [row] = await database
    .select({ value: sql<number>`coalesce(max(${boards.position}), -1)` })
    .from(boards)
    .where(eq(boards.projectId, projectId));
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
    throw new ApiError("One or more labels do not belong to this space.", 400);
  }
  return unique;
}
