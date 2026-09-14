import { randomUUID } from "node:crypto";

import { asc, eq, sql } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import { columns, tasks } from "@/db/schema";
import { ApiError } from "@/lib/api";
import type { BoardColumn } from "@/lib/types";
import type { ColumnCreateInput, ColumnUpdateInput } from "@/lib/validation";
import {
  isUniqueConstraintError,
  nextColumnPosition,
  requireBoard,
  requireColumn,
  serializeColumn,
} from "./queries";

async function clearOtherDoneColumns(
  tx: Parameters<Parameters<AppDatabase["transaction"]>[0]>[0],
  boardId: string,
  keepId: string,
): Promise<void> {
  await tx
    .update(columns)
    .set({ isDone: false, updatedAt: new Date() })
    .where(eq(columns.boardId, boardId));
  await tx
    .update(columns)
    .set({ isDone: true, updatedAt: new Date() })
    .where(eq(columns.id, keepId));
}

export async function createColumn(
  boardId: string,
  input: ColumnCreateInput,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<BoardColumn> {
  await requireBoard(database, boardId, ownerId);
  const position = await nextColumnPosition(database, boardId);
  const id = randomUUID();
  const now = new Date();

  try {
    await database.transaction(async (tx) => {
      if (input.isDone) {
        await tx
          .update(columns)
          .set({ isDone: false, updatedAt: now })
          .where(eq(columns.boardId, boardId));
      }
      await tx.insert(columns).values({
        id,
        boardId,
        name: input.name,
        position,
        isDone: input.isDone ?? false,
        createdAt: now,
        updatedAt: now,
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ApiError("A column with that name already exists.", 409);
    }
    throw error;
  }

  const [row] = await database
    .select()
    .from(columns)
    .where(eq(columns.id, id))
    .limit(1);
  if (!row) throw new ApiError("Column could not be created.", 500);
  return serializeColumn(row);
}

export async function updateColumn(
  columnId: string,
  input: ColumnUpdateInput,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<BoardColumn> {
  const existing = await requireColumn(database, columnId, ownerId);

  try {
    await database.transaction(async (tx) => {
      if (input.isDone) {
        await clearOtherDoneColumns(tx, existing.boardId, columnId);
      }
      const updates: Partial<typeof columns.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) updates.name = input.name;
      if (input.isDone !== undefined) updates.isDone = input.isDone;
      await tx.update(columns).set(updates).where(eq(columns.id, columnId));
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ApiError("A column with that name already exists.", 409);
    }
    throw error;
  }

  const [row] = await database
    .select()
    .from(columns)
    .where(eq(columns.id, columnId))
    .limit(1);
  if (!row) throw new ApiError("Column not found.", 404);
  return serializeColumn(row);
}

export async function deleteColumn(
  columnId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<{ movedTasks: number; targetColumnId: string }> {
  const column = await requireColumn(database, columnId, ownerId);
  const boardColumns = await database
    .select()
    .from(columns)
    .where(eq(columns.boardId, column.boardId))
    .orderBy(asc(columns.position));

  if (boardColumns.length <= 1) {
    throw new ApiError(
      "A board needs at least one column. Create another column first.",
      400,
    );
  }

  const target = boardColumns.find((item) => item.id !== columnId);
  if (!target) {
    throw new ApiError("No target column available.", 400);
  }

  const tasksToMove = await database
    .select()
    .from(tasks)
    .where(eq(tasks.columnId, columnId))
    .orderBy(asc(tasks.position));

  const [maxRow] = await database
    .select({ value: sql<number>`coalesce(max(${tasks.position}), -1)` })
    .from(tasks)
    .where(eq(tasks.columnId, target.id));
  const startPosition = (maxRow?.value ?? -1) + 1;
  const now = new Date();

  await database.transaction(async (tx) => {
    for (const [index, task] of tasksToMove.entries()) {
      await tx
        .update(tasks)
        .set({
          columnId: target.id,
          position: startPosition + index,
          completedAt: target.isDone ? (task.completedAt ?? now) : null,
          updatedAt: now,
        })
        .where(eq(tasks.id, task.id));
    }

    await tx.delete(columns).where(eq(columns.id, columnId));

    const remaining = boardColumns.filter((item) => item.id !== columnId);
    for (const [index, item] of remaining.entries()) {
      await tx
        .update(columns)
        .set({ position: index, updatedAt: now })
        .where(eq(columns.id, item.id));
    }
  });

  return { movedTasks: tasksToMove.length, targetColumnId: target.id };
}

export async function reorderColumns(
  boardId: string,
  columnIds: string[],
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<BoardColumn[]> {
  await requireBoard(database, boardId, ownerId);
  const boardColumns = await database
    .select()
    .from(columns)
    .where(eq(columns.boardId, boardId));
  if (boardColumns.length === 0) throw new ApiError("Board not found.", 404);

  const existing = new Set(boardColumns.map((column) => column.id));
  const incoming = new Set(columnIds);
  if (
    existing.size !== incoming.size ||
    columnIds.some((id) => !existing.has(id))
  ) {
    throw new ApiError(
      "Column order must include every column on the board exactly once.",
      400,
    );
  }

  const now = new Date();
  await database.transaction(async (tx) => {
    for (const [index, columnId] of columnIds.entries()) {
      await tx
        .update(columns)
        .set({ position: index, updatedAt: now })
        .where(eq(columns.id, columnId));
    }
  });

  const rows = await database
    .select()
    .from(columns)
    .where(eq(columns.boardId, boardId))
    .orderBy(asc(columns.position));
  return rows.map(serializeColumn);
}
