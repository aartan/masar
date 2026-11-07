import { and, eq } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import { boards, projects, whiteboards } from "@/db/schema";
import { ApiError } from "@/lib/api";
import type { WhiteboardScene } from "@/lib/types";
import { assertProjectWritable } from "./queries";

/**
 * Interim maximum serialized scene size. The cloud entity budget is larger
 * (4 MiB) to leave room for JSON escaping and the sync envelope, so a scene
 * that saves locally can fit when synced. R2 will later remove embedded images
 * from this payload.
 */
export const MAX_SCENE_BYTES = 2 * 1024 * 1024;

/** Resolve a whiteboard board owned by the caller, or throw 404. */
async function requireWhiteboardBoard(
  database: AppDatabase,
  boardId: string,
  ownerId: string,
) {
  const [row] = await database
    .select({ board: boards })
    .from(boards)
    .where(and(eq(boards.id, boardId), eq(boards.ownerId, ownerId)))
    .limit(1);
  if (!row) throw new ApiError("Board not found.", 404);
  if (row.board.type !== "whiteboard") {
    throw new ApiError("This board is not a whiteboard.", 400);
  }
  return row.board;
}

async function assertBoardProjectWritable(
  database: AppDatabase,
  projectId: string | null,
  ownerId: string,
): Promise<void> {
  if (!projectId) return;
  const [project] = await database
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)))
    .limit(1);
  if (project) assertProjectWritable(project);
}

export async function getWhiteboardScene(
  boardId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<WhiteboardScene> {
  await requireWhiteboardBoard(database, boardId, ownerId);
  const [row] = await database
    .select()
    .from(whiteboards)
    .where(eq(whiteboards.boardId, boardId))
    .limit(1);

  // A whiteboard row is created with the board, but be defensive: a board that
  // predates its scene row reads as an empty canvas.
  if (!row) {
    return { boardId, scene: "{}", updatedAt: new Date(0).toISOString() };
  }
  return {
    boardId: row.boardId,
    scene: row.scene,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function saveWhiteboardScene(
  boardId: string,
  scene: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<WhiteboardScene> {
  const board = await requireWhiteboardBoard(database, boardId, ownerId);
  await assertBoardProjectWritable(database, board.projectId, ownerId);

  const size = Buffer.byteLength(scene, "utf8");
  if (size > MAX_SCENE_BYTES) {
    throw new ApiError(
      "This whiteboard is too large to save. Reduce the number or size of images.",
      413,
    );
  }

  const now = new Date();
  await database
    .insert(whiteboards)
    .values({ boardId, scene, updatedAt: now })
    .onConflictDoUpdate({
      target: whiteboards.boardId,
      set: { scene, updatedAt: now },
    });

  // Touch the board so its updatedAt reflects the edit (activity, sync order).
  await database
    .update(boards)
    .set({ updatedAt: now })
    .where(and(eq(boards.id, boardId), eq(boards.ownerId, ownerId)));

  return { boardId, scene, updatedAt: now.toISOString() };
}
