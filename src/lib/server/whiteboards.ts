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
 * free local workspace keeps embedded images under the same limit.
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

interface DecodedImage {
  bytes: Buffer;
  contentType: string;
}

/** Decode an Excalidraw data URL without trusting its declared type. */
function decodeDataUrl(value: unknown): DecodedImage | null {
  if (typeof value !== "string" || !value.startsWith("data:")) return null;
  const comma = value.indexOf(",");
  if (comma < 5) return null;
  const metadata = value.slice(5, comma);
  const parts = metadata.split(";");
  const contentType = (parts[0] ?? "").trim().toLowerCase();
  if (!contentType.startsWith("image/")) return null;
  const base64 = parts
    .slice(1)
    .some((part) => part.trim().toLowerCase() === "base64");

  try {
    const payload = value.slice(comma + 1);
    const bytes = base64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    if (bytes.byteLength === 0) return null;
    return { bytes, contentType };
  } catch {
    return null;
  }
}

interface ExternalizedScene {
  scene: string;
  uploaded: RemoteImage[];
}

/**
 * Replace embedded Excalidraw files with `masar://<imageId>` references.
 * Already-referenced files are left untouched, so a normal autosave uploads
 * only newly added images.
 *
 * If image storage is unavailable during a rolling deploy (or the premium
 * session has expired) the save falls back to the embedded scene. Local work
 * is never lost just because R2 is unreachable; it can be externalised on a
 * later save.
 */
async function externalizeImages(
  scene: string,
  images: SceneImageStorage,
): Promise<ExternalizedScene> {
  const document = parseSceneDocument(scene);
  if (!document) return { scene, uploaded: [] };

  const files: Record<string, SceneFileRecord> = { ...document.files };
  const uploaded: RemoteImage[] = [];
  let changed = false;

  try {
    for (const [fileId, file] of Object.entries(files)) {
      if (imageReferenceId(file.dataURL)) continue;
      const decoded = decodeDataUrl(file.dataURL);
      if (!decoded) continue;

      const image = await images.upload({
        bytes: decoded.bytes,
        contentType: decoded.contentType,
        filename: fileId,
        kind: "whiteboard",
      });
      uploaded.push(image);
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

  let savedScene = scene;
  let uploaded: RemoteImage[] = [];
  if (images) {
    const externalized = await externalizeImages(scene, images);
    savedScene = externalized.scene;
    uploaded = externalized.uploaded;
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
  const now = new Date();

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

  // Do not touch the board row here. It used to refresh boards.updated_at for
  // activity, but activity already reads whiteboards.updated_at and the extra
  // board write queued a board sync change on every scene autosave. Two open
  // devices then raced meaningless board revisions and produced conflicts for
  // changes whose actual fields were identical.

  return { boardId, scene: savedScene, updatedAt: now.toISOString() };
}
