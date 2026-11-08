import { imageReferenceId } from "@/lib/whiteboard-scene";

/**
 * Hydration helpers for whiteboard scene files.
 *
 * A persisted scene references premium images with `masar://<imageId>` in
 * each Excalidraw file's `dataURL`. Before the renderer can hand the scene to
 * Excalidraw it needs real bytes, and fetching them from R2 can be slow or
 * fail. The local image cache answers immediately, so hydration is split into
 * two phases:
 *
 *  1. `hydrateSceneFiles` resolves every file it can from the local cache and
 *     returns the rest with their references intact (fast; the scene renders
 *     right away).
 *  2. The caller fetches the remaining remote copies in the background and
 *     feeds them to the canvas, then confirms each file so its local copy can
 *     be discarded.
 */

export interface HydratedSceneFiles {
  files: Record<string, unknown>;
  /** fileId → remote image id for every referenced file. */
  references: Map<string, string>;
  /** File ids whose bytes were served from the local cache. */
  cachedFileIds: Set<string>;
}

export interface SceneFileCacheReader {
  /** Resolve the local copy for a file, or null when it is not cached. */
  cached(boardId: string, fileId: string): Promise<Blob | null>;
}

/** Convert binary content to a data URL (works in Node and browsers). */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

/**
 * Resolve as many file references as possible from the local cache. Files
 * that are not cached keep their `masar://` reference so the caller can fetch
 * them from remote storage in the background.
 */
export async function hydrateSceneFiles(
  boardId: string,
  files: Record<string, unknown>,
  reader: SceneFileCacheReader,
): Promise<HydratedSceneFiles> {
  const hydrated = { ...files };
  const references = new Map<string, string>();
  const cachedFileIds = new Set<string>();

  await Promise.all(
    Object.entries(files).map(async ([fileId, value]) => {
      if (!value || typeof value !== "object") return;
      const file = value as Record<string, unknown>;
      const imageId = imageReferenceId(file.dataURL);
      if (!imageId) return;
      references.set(fileId, imageId);
      try {
        const blob = await reader.cached(boardId, fileId);
        if (!blob) return;
        hydrated[fileId] = { ...file, dataURL: await blobToDataUrl(blob) };
        cachedFileIds.add(fileId);
      } catch {
        // Keep the reference when the cache cannot be read.
      }
    }),
  );

  return { files: hydrated, references, cachedFileIds };
}
