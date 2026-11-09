import { and, eq, inArray } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import { boards, images as imagesTable, projects, whiteboards } from "@/db/schema";
import { ApiError } from "@/lib/api";
import type { WhiteboardScene } from "@/lib/types";
import {
  imageReference,
  imageReferenceId,
  parseSceneDocument,
  type SceneFileRecord,
} from "@/lib/whiteboard-scene";
import { decodeDataUrl } from "./image-data";
import {
  cachedRemoteIdsFor,
  pruneBoardCache,
  putCachedImage,
  setCachedRemoteId,
} from "./image-cache";
import {
  imageStorageUnavailable,
  premiumImageClient,
  removeSceneImages,
  sceneImageIds,
  type RemoteImage,
  type SceneImageStorage,
} from "./images";
import { assertProjectWritable } from "./queries";

/**
 * Maximum serialized scene size after images have been externalised. Premium
 * whiteboards store only `masar://` references, so this cap is generous; the
 * free local workspace keeps embedded images under the same limit. The
 * transient embedded scene written before externalisation is also bounded by
 * this cap so a sync cycle can never push an oversized entity.
 */
export const MAX_SCENE_BYTES = 2 * 1024 * 1024;

/**
 * Resolve a board that may carry images (a whiteboard, note or kanban board
 * with task attachments) owned by the caller, or throw 404. The image-cache
 * routes serve all space types.
 */
export async function requireImageBoard(
  database: AppDatabase,
  boardId: string,
  ownerId: string,
) {
  const [row] = await database
    .select({ board: boards })
    .from(boards)
    .where(and(eq(boards.id, boardId), eq(boards.ownerId, ownerId)))
    .limit(1);
  if (!row) throw new ApiError("Space not found.", 404);
  if (
    row.board.type !== "whiteboard" &&
    row.board.type !== "note" &&
    row.board.type !== "kanban"
  ) {
    throw new ApiError("This space does not hold images.", 400);
  }
  return row.board;
}

/** Resolve a whiteboard board owned by the caller, or throw 404. */
export async function requireWhiteboardBoard(
  database: AppDatabase,
  boardId: string,
  ownerId: string,
) {
  const board = await requireImageBoard(database, boardId, ownerId);
  if (board.type !== "whiteboard") {
    throw new ApiError("This space is not a whiteboard.", 400);
  }
  return board;
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

interface ExternalizedScene {
  scene: string;
  uploaded: RemoteImage[];
}

/**
 * Replace embedded Excalidraw files with `masar://<imageId>` references.
 * Already-referenced files are left untouched, and files whose bytes were
 * uploaded by an earlier save are remapped from the local cache instead of
 * being uploaded again.
 *
 * If image storage is unavailable during a rolling deploy (or the premium
 * session has expired) the save falls back to the embedded scene. Local work
 * is never lost just because R2 is unreachable; it can be externalised on a
 * later save.
 */
async function externalizeImages(
  boardId: string,
  scene: string,
  images: SceneImageStorage,
  database: AppDatabase,
): Promise<ExternalizedScene> {
  const document = parseSceneDocument(scene);
  if (!document) return { scene, uploaded: [] };

  const files: Record<string, SceneFileRecord> = { ...document.files };
  const uploaded: RemoteImage[] = [];
  const knownRemoteIds = await cachedRemoteIdsFor(boardId, database);
  let changed = false;

  try {
    for (const [fileId, file] of Object.entries(files)) {
      if (imageReferenceId(file.dataURL)) continue;
      const decoded = decodeDataUrl(file.dataURL);
      if (!decoded) continue;

      // The bytes may already live in R2 from an earlier save (for example
      // the renderer serialized this file before it learned the reference).
      const knownId = knownRemoteIds.get(fileId);
      if (knownId) {
        files[fileId] = { ...file, dataURL: imageReference(knownId) };
        changed = true;
        continue;
      }

      const image = await images.upload({
        bytes: decoded.bytes,
        contentType: decoded.contentType,
        filename: fileId,
        kind: "whiteboard",
      });
      uploaded.push(image);
      try {
        await putCachedImage(
          boardId,
          fileId,
          { bytes: decoded.bytes, contentType: decoded.contentType },
          database,
        );
        await setCachedRemoteId(boardId, fileId, image.id, database);
      } catch (error) {
        console.warn(`[masar] could not cache image ${fileId}`, error);
      }
      files[fileId] = { ...file, dataURL: imageReference(image.id) };
      changed = true;
    }
  } catch (error) {
    await removeSceneImages(images, uploaded.map((image) => image.id));
    if (imageStorageUnavailable(error)) {
      console.warn(
        "[masar] image storage unavailable; saving the scene with embedded images",
        error,
      );
      return { scene, uploaded: [] };
    }
    throw error;
  }

  if (!changed) return { scene, uploaded: [] };
  return {
    scene: JSON.stringify({ ...document.root, files }),
    uploaded,
  };
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
  images: SceneImageStorage | null = premiumImageClient(),
): Promise<WhiteboardScene> {
  const board = await requireWhiteboardBoard(database, boardId, ownerId);
  await assertBoardProjectWritable(database, board.projectId, ownerId);

  const [existing] = await database
    .select({ scene: whiteboards.scene })
    .from(whiteboards)
    .where(eq(whiteboards.boardId, boardId))
    .limit(1);

  const now = new Date();
  let savedScene = scene;
  let uploaded: RemoteImage[] = [];

  if (images) {
    // Retain the image bytes locally and make the scene durable before the
    // slow upload starts. A user who navigates away (or returns) while the
    // upload is still running never loses the image: the embedded scene is
    // already in SQLite and the bytes are in the local cache.
    const document = parseSceneDocument(scene);
    const embeddedFileIds: string[] = [];
    if (document) {
      for (const [fileId, file] of Object.entries(document.files)) {
        if (imageReferenceId(file.dataURL)) continue;
        const decoded = decodeDataUrl(file.dataURL);
        if (!decoded) continue;
        embeddedFileIds.push(fileId);
        try {
          await putCachedImage(
            boardId,
            fileId,
            { bytes: decoded.bytes, contentType: decoded.contentType },
            database,
          );
        } catch (error) {
          console.warn(`[masar] could not cache image ${fileId}`, error);
        }
      }
    }

    const embeddedSize = Buffer.byteLength(scene, "utf8");
    if (embeddedFileIds.length > 0 && embeddedSize <= MAX_SCENE_BYTES) {
      await database
        .insert(whiteboards)
        .values({ boardId, scene, updatedAt: now })
        .onConflictDoUpdate({
          target: whiteboards.boardId,
          set: { scene, updatedAt: now },
        });
    }

    try {
      const externalized = await externalizeImages(
        boardId,
        scene,
        images,
        database,
      );
      savedScene = externalized.scene;
      uploaded = externalized.uploaded;
    } catch (error) {
      // The remote rejected or failed the upload, but the image bytes and the
      // embedded scene are already safe locally. Keep the embedded scene and
      // try externalising again on a later save instead of losing work.
      if (embeddedSize <= MAX_SCENE_BYTES) {
        console.warn(
          "[masar] image upload failed; keeping the scene embedded for a later save",
          error,
        );
        savedScene = scene;
        uploaded = [];
      } else {
        throw error;
      }
    }
  }

  const size = Buffer.byteLength(savedScene, "utf8");
  if (size > MAX_SCENE_BYTES) {
    await removeSceneImages(
      images,
      uploaded.map((image) => image.id),
    );
    throw new ApiError(
      "This whiteboard is too large to save. Reduce the number or size of images.",
      413,
    );
  }

  const previousIds = sceneImageIds(existing?.scene);
  const nextIds = sceneImageIds(savedScene);
  const removedIds = [...previousIds].filter((id) => !nextIds.has(id));

  // Cache rows for files that no longer exist in the scene are stale.
  const liveFileIds = new Set<string>();
  const finalDocument = parseSceneDocument(savedScene);
  if (finalDocument) {
    for (const fileId of Object.keys(finalDocument.files)) liveFileIds.add(fileId);
  }

  try {
    await database.transaction(async (tx) => {
      await tx
        .insert(whiteboards)
        .values({ boardId, scene: savedScene, updatedAt: now })
        .onConflictDoUpdate({
          target: whiteboards.boardId,
          set: { scene: savedScene, updatedAt: now },
        });

      if (uploaded.length > 0) {
        await tx
          .insert(imagesTable)
          .values(
            uploaded.map((image) => ({
              id: image.id,
              boardId,
              kind: image.kind,
              contentType: image.contentType,
              byteSize: image.byteSize,
              width: image.width,
              height: image.height,
              thumbByteSize: image.thumbByteSize,
              thumbWidth: image.thumbWidth,
              thumbHeight: image.thumbHeight,
              createdAt: Number.isNaN(Date.parse(image.createdAt))
                ? now
                : new Date(image.createdAt),
            })),
          )
          .onConflictDoNothing();
      }

      if (removedIds.length > 0) {
        await tx
          .delete(imagesTable)
          .where(
            and(
              eq(imagesTable.boardId, boardId),
              inArray(imagesTable.id, removedIds),
            ),
          );
      }
    });
  } catch (error) {
    // The image bytes were stored but the scene row was not; do not leave
    // unreachable objects behind.
    await removeSceneImages(
      images,
      uploaded.map((image) => image.id),
    );
    throw error;
  }

  // Best-effort: local saves must not depend on the object store being up.
  await removeSceneImages(images, removedIds);
  await pruneBoardCache(boardId, liveFileIds, database);

  // Do not touch the board row here. It used to refresh boards.updated_at for
  // activity, but activity already reads whiteboards.updated_at and the extra
  // board write queued a board sync change on every scene autosave. Two open
  // devices then raced meaningless board revisions and produced conflicts for
  // changes whose actual fields were identical.

  return { boardId, scene: savedScene, updatedAt: now.toISOString() };
}
