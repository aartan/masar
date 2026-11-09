import { randomUUID } from "node:crypto";

import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import { taskImages, tasks } from "@/db/schema";
import { ApiError } from "@/lib/api";
import {
  dataUrlByteSize,
  MAX_EMBEDDED_TASK_IMAGE_BYTES,
  MAX_EMBEDDED_TASK_TOTAL_BYTES,
  MAX_TASK_IMAGES,
  taskImageUrl,
  taskImageUrlId,
} from "@/lib/task-image";
import type { TaskImage } from "@/lib/types";
import { parseImageDataUrl, verifyImageBytes } from "./image-data";
import { deleteCachedImage } from "./image-cache";
import {
  premiumImageClient,
  removeSceneImages,
  type SceneImageStorage,
} from "./images";
import { assertTaskWritable } from "./queries";

export interface AddTaskImageInput {
  imageId?: string;
  dataURL?: string;
  name?: string | null;
}

export interface TaskImageRow {
  id: string;
  taskId: string;
  url: string;
  name: string | null;
  position: number;
  createdAt: Date;
}

export function serializeTaskImage(row: TaskImageRow): TaskImage {
  return {
    id: row.id,
    taskId: row.taskId,
    url: row.url,
    name: row.name,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Every attachment of a task in display order. */
export async function fetchTaskImages(
  taskId: string,
  database: AppDatabase = getDb(),
): Promise<TaskImage[]> {
  const rows = await database
    .select()
    .from(taskImages)
    .where(eq(taskImages.taskId, taskId))
    .orderBy(asc(taskImages.position), asc(taskImages.createdAt));
  return rows.map(serializeTaskImage);
}

/** Attach an uploaded premium image or an embedded data URL to a task. */
export async function addTaskImage(
  taskId: string,
  input: AddTaskImageInput,
  ownerId: string,
  database: AppDatabase = getDb(),
  images: SceneImageStorage | null = premiumImageClient(),
): Promise<TaskImage> {
  await assertTaskWritable(database, taskId, ownerId);

  const [countRow] = await database
    .select({ value: count() })
    .from(taskImages)
    .where(eq(taskImages.taskId, taskId));
  if ((countRow?.value ?? 0) >= MAX_TASK_IMAGES) {
    throw new ApiError(
      `A task can have at most ${MAX_TASK_IMAGES} images.`,
      413,
    );
  }

  let url: string;
  let remoteId: string | null = null;

  if (input.imageId) {
    remoteId = input.imageId;
    url = taskImageUrl(input.imageId);

    // Retrying a create for an already-attached image should not duplicate the
    // row (or require the caller to delete the uploaded object).
    const [existing] = await database
      .select()
      .from(taskImages)
      .where(and(eq(taskImages.taskId, taskId), eq(taskImages.url, url)))
      .limit(1);
    if (existing) return serializeTaskImage(existing);
  } else if (input.dataURL) {
    const parsed = parseImageDataUrl(input.dataURL);
    if (!parsed.ok) {
      throw new ApiError(parsed.message, parsed.status);
    }
    if (parsed.bytes.byteLength > MAX_EMBEDDED_TASK_IMAGE_BYTES) {
      throw new ApiError(
        "This image is too large to attach without premium image storage.",
        413,
      );
    }
    verifyImageBytes(parsed.bytes, parsed.declaredContentType);

    const embedded = await database
      .select({ url: taskImages.url })
      .from(taskImages)
      .where(
        and(
          eq(taskImages.taskId, taskId),
          sql`${taskImages.url} like 'data:image/%'`,
        ),
      );
    const total = embedded.reduce(
      (sum, row) => sum + dataUrlByteSize(row.url),
      0,
    );
    if (total + parsed.bytes.byteLength > MAX_EMBEDDED_TASK_TOTAL_BYTES) {
      throw new ApiError(
        "This task has too many embedded images. Remove one or use premium image storage.",
        413,
      );
    }
    url = input.dataURL;
  } else {
    throw new ApiError("Provide an image to attach.", 422);
  }

  const [positionRow] = await database
    .select({ value: sql<number>`coalesce(max(${taskImages.position}), -1)` })
    .from(taskImages)
    .where(eq(taskImages.taskId, taskId));

  const now = new Date();
  const row = {
    id: randomUUID(),
    taskId,
    url,
    name: input.name?.trim() || null,
    position: (positionRow?.value ?? -1) + 1,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await database.insert(taskImages).values(row);
  } catch (error) {
    // The caller already uploaded the bytes; do not leave an unreachable R2
    // object behind when the attachment row could not be written.
    if (remoteId) await removeSceneImages(images, [remoteId]);
    throw error;
  }

  return serializeTaskImage(row);
}

/** Remove one attachment, its cache copy, and its R2 object when unreferenced. */
export async function deleteTaskImage(
  taskId: string,
  attachmentId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
  images: SceneImageStorage | null = premiumImageClient(),
): Promise<void> {
  const task = await assertTaskWritable(database, taskId, ownerId);
  const [row] = await database
    .select()
    .from(taskImages)
    .where(and(eq(taskImages.id, attachmentId), eq(taskImages.taskId, taskId)))
    .limit(1);
  if (!row) throw new ApiError("Image not found.", 404);

  const [referenceRow] = await database
    .select({ value: count() })
    .from(taskImages)
    .where(
      and(
        eq(taskImages.url, row.url),
        sql`${taskImages.id} <> ${attachmentId}`,
      ),
    );

  await database.delete(taskImages).where(eq(taskImages.id, attachmentId));

  if ((referenceRow?.value ?? 0) > 0) return;
  const imageId = taskImageUrlId(row.url);
  if (!imageId) return;
  await deleteCachedImage(task.boardId, imageId, database);
  await removeSceneImages(images, [imageId]);
}

/**
 * Clean up images belonging to tasks that were just deleted. Rows that share
 * a URL with a surviving duplicate keep both the cache copy and the R2 object.
 */
export async function cleanupDeletedTaskImages(
  boardId: string,
  urls: Iterable<string>,
  database: AppDatabase = getDb(),
  images: SceneImageStorage | null = premiumImageClient(),
): Promise<void> {
  for (const url of new Set(urls)) {
    const [referenceRow] = await database
      .select({ value: count() })
      .from(taskImages)
      .where(eq(taskImages.url, url));
    if ((referenceRow?.value ?? 0) > 0) continue;
    const imageId = taskImageUrlId(url);
    if (!imageId) continue;
    await deleteCachedImage(boardId, imageId, database);
    await removeSceneImages(images, [imageId]);
  }
}

/** Remote image ids referenced by tasks on the given boards. */
export async function taskImageIdsForBoards(
  database: AppDatabase,
  boardIds: string[],
): Promise<string[]> {
  if (boardIds.length === 0) return [];
  const rows = await database
    .select({ url: taskImages.url })
    .from(taskImages)
    .innerJoin(tasks, eq(taskImages.taskId, tasks.id))
    .where(inArray(tasks.boardId, boardIds));
  const ids = new Set<string>();
  for (const row of rows) {
    const id = taskImageUrlId(row.url);
    if (id) ids.add(id);
  }
  return [...ids];
}
