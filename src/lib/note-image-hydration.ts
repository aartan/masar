import {
  collectNoteImageIds,
  noteImageCacheUrl,
  noteImageUrl,
  rewriteNoteImageUrls,
} from "@/lib/note-document";

/**
 * Hydration helpers for note document images.
 *
 * A persisted note document references premium images with
 * `/api/images/<imageId>` URLs in each image block's `url` prop. When the
 * remote copy is unreachable (offline premium session), the image must still
 * render: the local image cache keeps a copy of every uploaded image keyed by
 * its image id. `hydrateNoteImages` rewrites each image URL to the local
 * cache endpoint when a cached copy exists, so the editor renders immediately
 * from SQLite and never depends on R2 being reachable.
 *
 * The save path canonicalizes those cache URLs back to `/api/images/<id>`
 * before persisting (see `canonicalizeNoteDocument`), so the database and
 * every synced device only ever see the canonical URL.
 */

export interface HydratedNoteDocument {
  /** The document with served-image URLs resolved to the local cache. */
  document: string;
  /** Image ids whose bytes were served from the local cache. */
  cachedImageIds: Set<string>;
}

export interface NoteImageCacheReader {
  /** Resolve the local copy for an image id, or null when it is not cached. */
  cached(boardId: string, imageId: string): Promise<Blob | null>;
}

/** Default reader backed by the local API's image-cache endpoint. */
export const apiNoteImageCacheReader: NoteImageCacheReader = {
  async cached(boardId, imageId) {
    try {
      const response = await fetch(noteImageCacheUrl(boardId, imageId), {
        cache: "no-store",
      });
      if (!response.ok) return null;
      return response.blob();
    } catch {
      return null;
    }
  },
};

/**
 * Resolve every referenced image that has a local cached copy. Image blocks
 * without a cached copy keep their canonical `/api/images/<id>` URL and load
 * from remote storage normally.
 */
export async function hydrateNoteImages(
  boardId: string,
  document: string,
  reader: NoteImageCacheReader,
): Promise<HydratedNoteDocument> {
  const imageIds = collectNoteImageIds(document);
  const cachedImageIds = new Set<string>();
  if (imageIds.length === 0) return { document, cachedImageIds };

  const resolved = await Promise.all(
    imageIds.map(async (imageId) => {
      try {
        const blob = await reader.cached(boardId, imageId);
        return blob ? imageId : null;
      } catch {
        return null;
      }
    }),
  );
  for (const imageId of resolved) {
    if (imageId) cachedImageIds.add(imageId);
  }
  if (cachedImageIds.size === 0) return { document, cachedImageIds };

  const hydrated = rewriteNoteImageUrls(document, boardId, (imageId) =>
    imageId !== null && cachedImageIds.has(imageId)
      ? noteImageCacheUrl(boardId, imageId)
      : imageId !== null
        ? noteImageUrl(imageId)
        : null,
  );
  return { document: hydrated, cachedImageIds };
}
