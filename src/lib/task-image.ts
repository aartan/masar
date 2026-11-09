/**
 * Helpers for task attachment image URLs, shared by the renderer, the local
 * API and tests.
 *
 * Premium task images use the same canonical URL as note images
 * (`/api/images/<imageId>`). The free local workspace keeps the image embedded
 * as a data URL. The local image cache is keyed by the remote image id and
 * served from `/api/boards/<boardId>/images/<imageId>/cache`.
 */

/** The local API path a premium task image is served from. */
export const TASK_IMAGE_URL_PREFIX = "/api/images/";

/** Largest embedded (free/offline) task image accepted, in decoded bytes. */
export const MAX_EMBEDDED_TASK_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * Total embedded bytes allowed on one task. Premium attachments store only
 * URLs, so this bound applies to the free/offline fallback and keeps a task
 * detail response and its synced entities reasonably small.
 */
export const MAX_EMBEDDED_TASK_TOTAL_BYTES = 8 * 1024 * 1024;

/** Maximum number of images attached to one task. */
export const MAX_TASK_IMAGES = 20;

/** MIME types accepted by the shared image storage API. */
export const TASK_IMAGE_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";

const CACHE_URL_PATTERN = /^\/api\/boards\/[^/]+\/images\/([^/]+)\/cache$/;

/** The canonical serving URL for a premium image id. */
export function taskImageUrl(imageId: string): string {
  return `${TASK_IMAGE_URL_PREFIX}${encodeURIComponent(imageId)}`;
}

/** The local-cache serving URL for a task image of a board. */
export function taskImageCacheUrl(boardId: string, imageId: string): string {
  return `/api/boards/${boardId}/images/${encodeURIComponent(imageId)}/cache`;
}

/**
 * The image id embedded in a canonical or cache-served image URL, or null for
 * another value (including embedded data URLs).
 */
export function taskImageUrlId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.startsWith(TASK_IMAGE_URL_PREFIX)) {
    const id = value.slice(TASK_IMAGE_URL_PREFIX.length).trim();
    return id.length > 0 ? id : null;
  }
  const match = CACHE_URL_PATTERN.exec(value);
  if (!match) return null;
  const id = decodeURIComponent(match[1] ?? "");
  return id.length > 0 ? id : null;
}

/** True when the value is an embedded image data URL. */
export function isImageDataUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:image/");
}

/** Approximate decoded byte size of a base64 data URL. */
export function dataUrlByteSize(value: string): number {
  const comma = value.indexOf(",");
  if (comma < 0) return 0;
  const metadata = value.slice(5, comma);
  const payload = value.slice(comma + 1);
  if (metadata.split(";").some((part) => part.trim().toLowerCase() === "base64")) {
    const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
  }
  try {
    return new TextEncoder().encode(decodeURIComponent(payload)).byteLength;
  } catch {
    return payload.length;
  }
}

/** The remote thumbnail URL for a premium image id. */
export function taskImageThumbUrl(imageId: string): string {
  return `${taskImageUrl(imageId)}?variant=thumb`;
}
