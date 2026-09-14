import { randomUUID } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import { boards, columns, tasks } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { DEFAULT_COLUMNS, type BoardColor } from "@/lib/constants";
import type { BoardDetail, BoardSummary } from "@/lib/types";
import type { BoardCreateInput, BoardUpdateInput } from "@/lib/validation";
import {
  fetchBoardSummaries,
  fetchBoardSummary,
  fetchColumns,
  fetchLabels,
  fetchTasks,
  nextBoardPosition,
  requireBoard,
} from "./queries";

export async function listBoards(
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<BoardSummary[]> {
  return fetchBoardSummaries(database, ownerId);
}

export async function getBoardDetail(
  boardId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<BoardDetail> {
  const board = await fetchBoardSummary(database, boardId, ownerId);
  if (!board) throw new ApiError("Board not found.", 404);

  const [columnsData, tasksData, labelsData] = await Promise.all([
    fetchColumns(database, boardId, ownerId),
    fetchTasks(database, { ownerId, boardId }),
    fetchLabels(database, boardId, ownerId),
  ]);

  return {
    board,
    columns: columnsData,
    tasks: tasksData,
    labels: labelsData,
  };
}

export async function createBoard(
  input: BoardCreateInput,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<BoardSummary> {
  const position = await nextBoardPosition(database, ownerId);
  const boardId = randomUUID();
  const now = new Date();

  await database.transaction(async (tx) => {
    await tx.insert(boards).values({
      id: boardId,
      ownerId,
      name: input.name,
      description: input.description?.trim() || null,
      color: (input.color ?? "sage") satisfies BoardColor,
      position,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(columns).values(
      DEFAULT_COLUMNS.map((column, index) => ({
        id: randomUUID(),
        boardId,
        name: column.name,
        position: index,
        isDone: column.isDone,
        createdAt: now,
        updatedAt: now,
      })),
    );
  });

  const board = await fetchBoardSummary(database, boardId, ownerId);
  if (!board) throw new ApiError("Board could not be created.", 500);
  return board;
}

export async function updateBoard(
  boardId: string,
  input: BoardUpdateInput,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<BoardSummary> {
  await requireBoard(database, boardId, ownerId);
  await database
    .update(boards)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(boards.id, boardId), eq(boards.ownerId, ownerId)));

  const board = await fetchBoardSummary(database, boardId, ownerId);
  if (!board) throw new ApiError("Board not found.", 404);
  return board;
}

export async function deleteBoard(
  boardId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<void> {
  await requireBoard(database, boardId, ownerId);
  await database
    .delete(boards)
    .where(and(eq(boards.id, boardId), eq(boards.ownerId, ownerId)));
}

export async function listBoardTaskCount(
  boardId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<number> {
  await requireBoard(database, boardId, ownerId);
  const [row] = await database
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(tasks)
    .where(eq(tasks.boardId, boardId));
  return row?.value ?? 0;
}

/** Used by the board settings dialog to warn before deleting. */
export async function getBoardDeletionSummary(
  boardId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<{ taskCount: number; columnCount: number }> {
  await requireBoard(database, boardId, ownerId);
  const [taskRow] = await database
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(tasks)
    .where(eq(tasks.boardId, boardId));
  const [columnRow] = await database
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(columns)
    .where(and(eq(columns.boardId, boardId)));
  return {
    taskCount: taskRow?.value ?? 0,
    columnCount: columnRow?.value ?? 0,
  };
}

export async function boardOptions(
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<Array<{ id: string; name: string }>> {
  return database
    .select({ id: boards.id, name: boards.name })
    .from(boards)
    .where(eq(boards.ownerId, ownerId))
    .orderBy(asc(boards.position));
}
