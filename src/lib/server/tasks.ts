import { randomUUID } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import {
  columns,
  comments,
  subtasks,
  taskImages,
  taskLabels,
  tasks,
} from "@/db/schema";
import { ApiError } from "@/lib/api";
import type { Comment, Subtask, Task, TaskDetail } from "@/lib/types";
import type {
  ReorderTasksInput,
  TaskCreateInput,
  TaskUpdateInput,
} from "@/lib/validation";
import {
  assertBoardWritable,
  assertLabelsBelongToBoard,
  assertTaskWritable,
  fetchTasks,
  nextTaskPosition,
  requireBoard,
  requireColumn,
} from "./queries";
import { cleanupDeletedTaskImages, fetchTaskImages } from "./task-images";
import {
  premiumImageClient,
  type SceneImageStorage,
} from "./images";

export function serializeSubtask(row: {
  id: string;
  taskId: string;
  title: string;
  completed: boolean;
  position: number;
  createdAt: Date;
}): Subtask {
  return {
    id: row.id,
    taskId: row.taskId,
    title: row.title,
    completed: row.completed,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeComment(row: {
  id: string;
  taskId: string;
  author: string;
  body: string;
  createdAt: Date;
}): Comment {
  return {
    id: row.id,
    taskId: row.taskId,
    author: row.author,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getTaskDetail(
  taskId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<TaskDetail> {
  const task = (await fetchTasks(database, { ownerId, taskId }))[0];
  if (!task) throw new ApiError("Task not found.", 404);

  const [subtaskRows, commentRows, images] = await Promise.all([
    database
      .select()
      .from(subtasks)
      .where(eq(subtasks.taskId, taskId))
      .orderBy(asc(subtasks.position), asc(subtasks.createdAt)),
    database
      .select()
      .from(comments)
      .where(eq(comments.taskId, taskId))
      .orderBy(asc(comments.createdAt)),
    fetchTaskImages(taskId, database),
  ]);

  return {
    ...task,
    subtasks: subtaskRows.map(serializeSubtask),
    comments: commentRows.map(serializeComment),
    images,
  };
}

export async function createTask(
  boardId: string,
  input: TaskCreateInput,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<TaskDetail> {
  await assertBoardWritable(database, boardId, ownerId);
  const column = await requireColumn(database, input.columnId, ownerId);
  if (column.boardId !== boardId) {
    throw new ApiError("That column does not belong to this space.", 400);
  }

  const labelIds = await assertLabelsBelongToBoard(
    database,
    boardId,
    input.labelIds ?? [],
  );
  const position = await nextTaskPosition(database, input.columnId);
  const id = randomUUID();
  const now = new Date();

  await database.transaction(async (tx) => {
    await tx.insert(tasks).values({
      id,
      boardId,
      columnId: input.columnId,
      title: input.title,
      description: input.description?.trim() || null,
      priority: input.priority ?? "none",
      dueDate: input.dueDate ?? null,
      position,
      completedAt: column.isDone ? now : null,
      createdAt: now,
      updatedAt: now,
    });

    if (labelIds.length > 0) {
      await tx
        .insert(taskLabels)
        .values(labelIds.map((labelId) => ({ taskId: id, labelId })));
    }
  });

  return getTaskDetail(id, ownerId, database);
}

export async function updateTask(
  taskId: string,
  input: TaskUpdateInput,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<TaskDetail> {
  const existing = await assertTaskWritable(database, taskId, ownerId);
  let nextColumnId = existing.columnId;
  let nextPosition = existing.position;
  let completedAt = existing.completedAt;

  if (input.columnId && input.columnId !== existing.columnId) {
    const target = await requireColumn(database, input.columnId, ownerId);
    if (target.boardId !== existing.boardId) {
      throw new ApiError("That column does not belong to this space.", 400);
    }
    nextColumnId = target.id;
    nextPosition = await nextTaskPosition(database, target.id);
    if (target.isDone) {
      completedAt = existing.completedAt ?? new Date();
    } else {
      completedAt = null;
    }
  }

  const labelIds =
    input.labelIds !== undefined
      ? await assertLabelsBelongToBoard(
          database,
          existing.boardId,
          input.labelIds,
        )
      : undefined;

  await database.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        columnId: nextColumnId,
        position: nextPosition,
        completedAt,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));

    if (labelIds !== undefined) {
      await tx.delete(taskLabels).where(eq(taskLabels.taskId, taskId));
      if (labelIds.length > 0) {
        await tx
          .insert(taskLabels)
          .values(labelIds.map((labelId) => ({ taskId, labelId })));
      }
    }
  });

  return getTaskDetail(taskId, ownerId, database);
}

export async function deleteTask(
  taskId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
  images: SceneImageStorage | null = premiumImageClient(),
): Promise<void> {
  const task = await assertTaskWritable(database, taskId, ownerId);
  const imageRows = await database
    .select({ url: taskImages.url })
    .from(taskImages)
    .where(eq(taskImages.taskId, taskId));

  await database.delete(tasks).where(eq(tasks.id, taskId));

  // Duplicated tasks share the same URLs, so only unreferenced objects are
  // removed. Cache rows are board-scoped and shared by those duplicates too.
  await cleanupDeletedTaskImages(
    task.boardId,
    imageRows.map((row) => row.url),
    database,
    images,
  );
}

export async function duplicateTask(
  taskId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<TaskDetail> {
  const source = await assertTaskWritable(database, taskId, ownerId);
  const position = await nextTaskPosition(database, source.columnId);
  const newId = randomUUID();
  const now = new Date();

  const [sourceLabels, sourceSubtasks, sourceImages] = await Promise.all([
    database
      .select({ labelId: taskLabels.labelId })
      .from(taskLabels)
      .where(eq(taskLabels.taskId, taskId)),
    database
      .select()
      .from(subtasks)
      .where(eq(subtasks.taskId, taskId))
      .orderBy(asc(subtasks.position)),
    database
      .select()
      .from(taskImages)
      .where(eq(taskImages.taskId, taskId))
      .orderBy(asc(taskImages.position)),
  ]);

  const title = `${source.title} (copy)`.slice(0, 200);

  await database.transaction(async (tx) => {
    await tx.insert(tasks).values({
      id: newId,
      boardId: source.boardId,
      columnId: source.columnId,
      title,
      description: source.description,
      priority: source.priority,
      dueDate: source.dueDate,
      position,
      completedAt: source.completedAt ? now : null,
      createdAt: now,
      updatedAt: now,
    });

    if (sourceLabels.length > 0) {
      await tx
        .insert(taskLabels)
        .values(
          sourceLabels.map((row) => ({ taskId: newId, labelId: row.labelId })),
        );
    }

    if (sourceSubtasks.length > 0) {
      await tx.insert(subtasks).values(
        sourceSubtasks.map((row, index) => ({
          id: randomUUID(),
          taskId: newId,
          title: row.title,
          completed: row.completed,
          position: index,
          createdAt: now,
        })),
      );
    }

    if (sourceImages.length > 0) {
      // Copies share the same image URL (and therefore the same R2 object),
      // so delete paths reference-check before removing an object or its
      // local cache entry.
      await tx.insert(taskImages).values(
        sourceImages.map((row) => ({
          id: randomUUID(),
          taskId: newId,
          url: row.url,
          name: row.name,
          position: row.position,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }
  });

  return getTaskDetail(newId, ownerId, database);
}

export async function reorderTasks(
  boardId: string,
  input: ReorderTasksInput,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<Task[]> {
  await assertBoardWritable(database, boardId, ownerId);
  const [boardColumns, boardTasks] = await Promise.all([
    database
      .select()
      .from(columns)
      .where(eq(columns.boardId, boardId)),
    database.select().from(tasks).where(eq(tasks.boardId, boardId)),
  ]);
  if (boardColumns.length === 0) throw new ApiError("Space not found.", 404);

  const columnMap = new Map(boardColumns.map((column) => [column.id, column]));
  const taskMap = new Map(boardTasks.map((task) => [task.id, task]));
  const incomingColumns = new Set(input.columns.map((column) => column.columnId));

  if (
    incomingColumns.size !== boardColumns.length ||
    input.columns.some((column) => !columnMap.has(column.columnId))
  ) {
    throw new ApiError(
      "Task order must include every column on the space.",
      400,
    );
  }

  const seen = new Set<string>();
  for (const column of input.columns) {
    for (const taskId of column.taskIds) {
      if (!taskMap.has(taskId)) {
        throw new ApiError("A task in the order payload does not exist.", 400);
      }
      if (seen.has(taskId)) {
        throw new ApiError(
          "A task can only appear once in the order payload.",
          400,
        );
      }
      seen.add(taskId);
    }
  }

  if (seen.size !== boardTasks.length) {
    throw new ApiError(
      "Task order must include every task on the space exactly once.",
      400,
    );
  }

  const now = new Date();
  await database.transaction(async (tx) => {
    for (const columnOrder of input.columns) {
      const targetColumn = columnMap.get(columnOrder.columnId);
      if (!targetColumn) continue;

      for (const [index, taskId] of columnOrder.taskIds.entries()) {
        const existing = taskMap.get(taskId);
        if (!existing) continue;

        const completedAt = targetColumn.isDone
          ? existing.completedAt ?? now
          : null;
        // A task drag rewrites the whole order payload, but only the moved
        // task and tasks whose positions genuinely shifted need a local write
        // (and therefore a sync change).
        if (
          existing.columnId === targetColumn.id &&
          existing.position === index &&
          (existing.completedAt?.getTime() ?? null) ===
            (completedAt?.getTime() ?? null)
        ) {
          continue;
        }

        await tx
          .update(tasks)
          .set({
            columnId: targetColumn.id,
            position: index,
            completedAt,
            updatedAt: now,
          })
          .where(eq(tasks.id, taskId));
      }
    }
  });

  return fetchTasks(database, { ownerId, boardId });
}

export async function listTaskOptions(
  boardId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<Array<{ id: string; title: string; columnId: string }>> {
  await requireBoard(database, boardId, ownerId);
  return database
    .select({ id: tasks.id, title: tasks.title, columnId: tasks.columnId })
    .from(tasks)
    .where(eq(tasks.boardId, boardId))
    .orderBy(asc(tasks.position));
}

export async function countTasksInColumn(
  columnId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<number> {
  await requireColumn(database, columnId, ownerId);
  const [row] = await database
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(tasks)
    .where(and(eq(tasks.columnId, columnId)));
  return row?.value ?? 0;
}
