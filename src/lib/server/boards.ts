import { randomUUID } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import {
  boards,
  columns,
  images as imagesTable,
  projects,
  tasks,
  whiteboards,
} from "@/db/schema";
import { ApiError } from "@/lib/api";
import { DEFAULT_COLUMNS, type BoardColor, type BoardType } from "@/lib/constants";
import type { BoardDetail, BoardSummary } from "@/lib/types";
import type {
  BoardCreateInput,
  BoardUpdateInput,
  MoveBoardInput,
} from "@/lib/validation";
import {
  assertBoardWritable,
  assertProjectWritable,
  fetchBoardSummaries,
  fetchBoardSummary,
  fetchColumns,
  fetchLabels,
  fetchTasks,
  nextBoardPositionInProject,
  requireBoard,
  requireProject,
} from "./queries";
import {
  premiumImageClient,
  removeSceneImages,
  sceneImageIds,
  type SceneImageStorage,
} from "./images";
import { deleteBoardCache } from "./image-cache";
import { ensureDefaultProject } from "./projects";
import { DEFAULT_PROJECT_NAME } from "@/lib/constants";

export async function listBoards(
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<BoardSummary[]> {
  return fetchBoardSummaries(database, ownerId);
}

export async function reorderBoards(
  boardIds: string[],
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<BoardSummary[]> {
  const boardRows = await database
    .select({ id: boards.id })
    .from(boards)
    .where(eq(boards.ownerId, ownerId));

  const existing = new Set(boardRows.map((board) => board.id));
  const incoming = new Set(boardIds);
  if (
    boardIds.length !== incoming.size ||
    existing.size !== incoming.size ||
    boardIds.some((id) => !existing.has(id))
  ) {
    throw new ApiError(
      "Board order must include every board in the workspace exactly once.",
      400,
    );
  }

  const archived = await database
    .select({ id: boards.id })
    .from(boards)
    .innerJoin(projects, eq(boards.projectId, projects.id))
    .where(and(eq(boards.ownerId, ownerId), eq(projects.archived, true)));
  if (archived.length > 0) {
    throw new ApiError(
      "Restore archived projects before reordering their boards.",
      409,
    );
  }

  const now = new Date();
  await database.transaction(async (tx) => {
    for (const [index, boardId] of boardIds.entries()) {
      await tx
        .update(boards)
        .set({ position: index, updatedAt: now })
        .where(and(eq(boards.id, boardId), eq(boards.ownerId, ownerId)));
    }
  });

  return fetchBoardSummaries(database, ownerId);
}

/**
 * Set the exact ordering of boards within one project, moving any board that
 * currently lives elsewhere into it. `boardIds` is the full, final list of
 * boards for the target project, in order — this powers both reordering within
 * a project and dragging a board in from another project. Every id must be an
 * owned board; the target project must be writable (not archived), and a board
 * cannot be moved out of an archived source project.
 */
export async function moveBoard(
  input: MoveBoardInput,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<BoardSummary[]> {
  const targetProject = await requireProject(database, input.projectId, ownerId);
  assertProjectWritable(targetProject);

  const owned = await database
    .select({ id: boards.id, projectId: boards.projectId })
    .from(boards)
    .where(eq(boards.ownerId, ownerId));
  const ownedById = new Map(owned.map((row) => [row.id, row.projectId]));

  const incoming = new Set(input.boardIds);
  if (
    input.boardIds.length !== incoming.size ||
    input.boardIds.some((id) => !ownedById.has(id))
  ) {
    throw new ApiError(
      "Board order must list owned boards exactly once.",
      400,
    );
  }

  // A board arriving from another project must not be leaving an archived one.
  const sourceProjectIds = new Set(
    input.boardIds
      .map((id) => ownedById.get(id))
      .filter((id): id is string => Boolean(id) && id !== input.projectId),
  );
  for (const sourceId of sourceProjectIds) {
    const source = await requireProject(database, sourceId, ownerId);
    assertProjectWritable(source);
  }

  const now = new Date();
  await database.transaction(async (tx) => {
    for (const [index, boardId] of input.boardIds.entries()) {
      await tx
        .update(boards)
        .set({ projectId: input.projectId, position: index, updatedAt: now })
        .where(and(eq(boards.id, boardId), eq(boards.ownerId, ownerId)));
    }
  });

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
  // Resolve the target project. An explicit projectId must be owned and
  // writable; otherwise fall back to the workspace's default project, creating
  // it on first use so a board always has a home.
  let projectId: string;
  if (input.projectId) {
    const project = await requireProject(database, input.projectId, ownerId);
    assertProjectWritable(project);
    projectId = project.id;
  } else {
    projectId = await ensureDefaultProject(ownerId, DEFAULT_PROJECT_NAME, database);
    assertProjectWritable(await requireProject(database, projectId, ownerId));
  }

  const type: BoardType = input.type ?? "kanban";
  const position = await nextBoardPositionInProject(database, projectId);
  const boardId = randomUUID();
  const now = new Date();

  await database.transaction(async (tx) => {
    await tx.insert(boards).values({
      id: boardId,
      ownerId,
      projectId,
      type,
      name: input.name,
      description: input.description?.trim() || null,
      color: (input.color ?? "sage") satisfies BoardColor,
      position,
      createdAt: now,
      updatedAt: now,
    });

    if (type === "whiteboard") {
      // A whiteboard has no Kanban columns; it starts with an empty scene.
      await tx.insert(whiteboards).values({
        boardId,
        scene: "{}",
        updatedAt: now,
      });
    } else {
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
    }
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
  const existing = await assertBoardWritable(database, boardId, ownerId);
  let position: number | undefined;
  if (input.projectId && input.projectId !== existing.projectId) {
    const target = await requireProject(database, input.projectId, ownerId);
    assertProjectWritable(target);
    position = await nextBoardPositionInProject(database, target.id);
  }
  await database
    .update(boards)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(position !== undefined ? { position } : {}),
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
  images: SceneImageStorage | null = premiumImageClient(),
): Promise<void> {
  await assertBoardWritable(database, boardId, ownerId);

  // Collect image ids before the board (and its scene) disappears. Both the
  // scene markers and the local metadata table are consulted because a board
  // synced from another device may have references without local metadata.
  const [sceneRow] = await database
    .select({ scene: whiteboards.scene })
    .from(whiteboards)
    .where(eq(whiteboards.boardId, boardId))
    .limit(1);
  const stored = await database
    .select({ id: imagesTable.id })
    .from(imagesTable)
    .where(eq(imagesTable.boardId, boardId));
  const imageIds = sceneImageIds(sceneRow?.scene);
  for (const row of stored) imageIds.add(row.id);

  // Local image copies must not outlive the board (the FK also cascades, but
  // foreign keys are not always enforced on every connection).
  await deleteBoardCache(boardId, database);

  await database
    .delete(boards)
    .where(and(eq(boards.id, boardId), eq(boards.ownerId, ownerId)));

  await removeSceneImages(images, imageIds);
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
