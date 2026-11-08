import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import { imageCache } from "@/db/schema";

/**
 * Local copy of whiteboard image bytes (see the `image_cache` table docs in
 * the schema). The cache is the durable fallback while an upload is in
 * flight, the display source when the remote copy is unreachable, and the
 * upload ledger that prevents duplicate R2 uploads on later saves.
 */

/** Largest single image accepted into the local cache. */
export const MAX_CACHED_IMAGE_BYTES = 25 * 1024 * 1024;

/**
 * Soft cap for the whole cache. When exceeded, the oldest rows that already
 * have a remote copy are dropped first (their bytes are safe in R2), then the
 * oldest rows overall.
 */
export const MAX_CACHE_TOTAL_BYTES = 512 * 1024 * 1024;

export interface CachedImageContent {
  contentType: string;
  bytes: Buffer;
}

/** Upsert the local copy of a canvas file's bytes. */
export async function putCachedImage(
  boardId: string,
  fileId: string,
  content: CachedImageContent,
  database: AppDatabase = getDb(),
): Promise<void> {
  const now = new Date();
  await database
    .insert(imageCache)
    .values({
      boardId,
      fileId,
      contentType: content.contentType,
      byteSize: content.bytes.byteLength,
      bytes: content.bytes,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [imageCache.boardId, imageCache.fileId],
      set: {
        contentType: content.contentType,
        byteSize: content.bytes.byteLength,
        bytes: content.bytes,
        updatedAt: now,
      },
    });
  await pruneCache(database);
}

/** Read the local copy for a canvas file, or null when it is not cached. */
export async function getCachedImage(
  boardId: string,
  fileId: string,
  database: AppDatabase = getDb(),
): Promise<CachedImageContent | null> {
  const [row] = await database
    .select({ contentType: imageCache.contentType, bytes: imageCache.bytes })
    .from(imageCache)
    .where(and(eq(imageCache.boardId, boardId), eq(imageCache.fileId, fileId)))
    .limit(1);
  if (!row) return null;
  return { contentType: row.contentType, bytes: row.bytes };
}

/** The remote image id recorded for an uploaded file, if any. */
export async function getCachedRemoteId(
  boardId: string,
  fileId: string,
  database: AppDatabase = getDb(),
): Promise<string | null> {
  const [row] = await database
    .select({ remoteImageId: imageCache.remoteImageId })
    .from(imageCache)
    .where(and(eq(imageCache.boardId, boardId), eq(imageCache.fileId, fileId)))
    .limit(1);
  return row?.remoteImageId ?? null;
}

/** Record the remote id assigned to an uploaded file (the upload ledger). */
export async function setCachedRemoteId(
  boardId: string,
  fileId: string,
  remoteImageId: string,
  database: AppDatabase = getDb(),
): Promise<void> {
  await database
    .update(imageCache)
    .set({ remoteImageId, updatedAt: new Date() })
    .where(and(eq(imageCache.boardId, boardId), eq(imageCache.fileId, fileId)));
}

/**
 * Remote ids for every cached file of a board. Saves use this map to replace
 * embedded bytes with their references without uploading them again.
 */
export async function cachedRemoteIdsFor(
  boardId: string,
  database: AppDatabase = getDb(),
): Promise<Map<string, string>> {
  const rows = await database
    .select({ fileId: imageCache.fileId, remoteImageId: imageCache.remoteImageId })
    .from(imageCache)
    .where(eq(imageCache.boardId, boardId));
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.remoteImageId) map.set(row.fileId, row.remoteImageId);
  }
  return map;
}

/**
 * Remove the local copy now that the renderer has confirmed the remote image
 * is available and displayed.
 */
export async function deleteCachedImage(
  boardId: string,
  fileId: string,
  database: AppDatabase = getDb(),
): Promise<boolean> {
  const result = await database
    .delete(imageCache)
    .where(and(eq(imageCache.boardId, boardId), eq(imageCache.fileId, fileId)));
  return result.rowsAffected > 0;
}

/** Drop the local copies of files that are no longer part of the scene. */
export async function pruneBoardCache(
  boardId: string,
  liveFileIds: ReadonlySet<string>,
  database: AppDatabase = getDb(),
): Promise<void> {
  const rows = await database
    .select({ fileId: imageCache.fileId })
    .from(imageCache)
    .where(eq(imageCache.boardId, boardId));
  const removed = rows
    .map((row) => row.fileId)
    .filter((fileId) => !liveFileIds.has(fileId));
  if (removed.length === 0) return;
  await database
    .delete(imageCache)
    .where(
      and(eq(imageCache.boardId, boardId), inArray(imageCache.fileId, removed)),
    );
}

/** Remove every local copy for a board (board/project deletion). */
export async function deleteBoardCache(
  boardId: string,
  database: AppDatabase = getDb(),
): Promise<void> {
  await database.delete(imageCache).where(eq(imageCache.boardId, boardId));
}

export async function deleteBoardsCache(
  boardIds: string[],
  database: AppDatabase = getDb(),
): Promise<void> {
  if (boardIds.length === 0) return;
  await database.delete(imageCache).where(inArray(imageCache.boardId, boardIds));
}

/**
 * Bound the cache. Rows with a remote copy are dropped first because their
 * bytes are already safe in R2; only when those run out are the oldest
 * remaining rows dropped.
 */
export async function pruneCache(
  database: AppDatabase = getDb(),
  keepBytes = MAX_CACHE_TOTAL_BYTES,
): Promise<void> {
  const [totalRow] = await database
    .select({
      total: sql<number>`coalesce(sum(${imageCache.byteSize}), 0)`.mapWith(Number),
    })
    .from(imageCache);
  let total = totalRow?.total ?? 0;
  if (total <= keepBytes) return;

  // Prefer dropping rows that already have a remote copy.
  for (const confirmedOnly of [true, false]) {
    if (total <= keepBytes) break;
    for (;;) {
      const rows = await database
        .select()
        .from(imageCache)
        .where(confirmedOnly ? isNotNull(imageCache.remoteImageId) : undefined)
        .orderBy(asc(imageCache.createdAt))
        .limit(100);
      if (rows.length === 0) break;
      for (const row of rows) {
        await database
          .delete(imageCache)
          .where(
            and(
              eq(imageCache.boardId, row.boardId),
              eq(imageCache.fileId, row.fileId),
            ),
          );
        total -= row.byteSize;
        if (total <= keepBytes) return;
      }
    }
  }
}
