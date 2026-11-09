import { ApiError } from "@/lib/api";
import type { ImageKind } from "@/lib/constants";
import { checkImageBytes } from "@/lib/image-file";
import { collectSceneImageIds } from "@/lib/whiteboard-scene";

/**
 * Premium image storage proxy.
 *
 * Image binaries and their metadata live only in the Premium API (Cloudflare
 * R2 + PostgreSQL). The local API never receives R2 credentials: Electron
 * passes it the signed-in session token and API URL, and this module forwards
 * uploads and downloads with that token. The local SQLite database only keeps
 * image ids and metadata.
 */

export type ImageVariant = "original" | "thumb";

export interface RemoteImage {
  id: string;
  kind: ImageKind;
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
  thumbByteSize: number;
  thumbWidth: number;
  thumbHeight: number;
  createdAt: string;
}

export interface UploadImageInput {
  bytes: Uint8Array;
  contentType: string;
  filename?: string;
  kind: ImageKind;
}

export interface ImageContent {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * The part of the image service a whiteboard save needs. Tests can supply a
 * fake without making HTTP requests.
 */
export interface SceneImageStorage {
  upload(input: UploadImageInput): Promise<RemoteImage>;
  remove(imageId: string): Promise<void>;
}

export interface ImageStorageClient extends SceneImageStorage {
  upload(input: UploadImageInput): Promise<RemoteImage>;
  download(imageId: string, variant?: ImageVariant): Promise<ImageContent>;
  remove(imageId: string): Promise<void>;
}

export interface ImageStorageConfig {
  apiUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  uploadTimeoutMs?: number;
  requestTimeoutMs?: number;
}

function normalizeApiUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function imageStorageConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    env.MASAR_API_URL?.trim() && env.MASAR_SYNC_TOKEN?.trim(),
  );
}

interface ErrorBody {
  error?: string;
}

function retryableStatus(status: number): boolean {
  return (
    status === 401 ||
    status === 402 ||
    status === 404 ||
    status === 409 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

/** Image storage is optional while the Premium API rolls out R2 support. */
export function imageStorageUnavailable(error: unknown): boolean {
  return error instanceof ApiError && retryableStatus(error.status);
}

export function createImageStorageClient(
  config: ImageStorageConfig,
): ImageStorageClient {
  const apiUrl = normalizeApiUrl(config.apiUrl);
  const fetchImpl = config.fetchImpl ?? fetch;
  const requestTimeoutMs = config.requestTimeoutMs ?? 20_000;
  const uploadTimeoutMs = config.uploadTimeoutMs ?? 60_000;

  async function send(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(`${apiUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.token}`,
          ...init.headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? "Image storage took too long to respond."
          : "Could not reach image storage. Check your connection.";
      throw new ApiError(message, 502);
    }

    if (!response.ok) {
      let body: ErrorBody | null = null;
      try {
        body = (await response.json()) as ErrorBody;
      } catch {
        body = null;
      }
      throw new ApiError(
        body?.error ?? `Image storage returned ${response.status}.`,
        response.status,
      );
    }
    return response;
  }

  return {
    async upload(input) {
      const check = checkImageBytes(input.bytes, input.contentType);
      if (!check.ok) {
        throw new ApiError(check.message, check.status);
      }

      const form = new FormData();
      form.append(
        "file",
        new Blob([input.bytes as BlobPart], {
          type: check.contentType,
        }),
        input.filename ?? "image",
      );
      form.append("kind", input.kind);

      const response = await send(
        "/v1/images",
        { method: "POST", body: form },
        uploadTimeoutMs,
      );
      const payload = (await response.json()) as { image: RemoteImage };
      return payload.image;
    },

    async download(imageId, variant = "original") {
      const query = variant === "thumb" ? "?variant=thumb" : "";
      const response = await send(
        `/v1/images/${encodeURIComponent(imageId)}${query}`,
        { method: "GET" },
        requestTimeoutMs,
      );
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") ?? "image/webp",
      };
    },

    async remove(imageId) {
      try {
        await send(
          `/v1/images/${encodeURIComponent(imageId)}`,
          { method: "DELETE" },
          requestTimeoutMs,
        );
      } catch (error) {
        // Deleting an object that is already gone is success.
        if (error instanceof ApiError && error.status === 404) return;
        throw error;
      }
    },
  };
}

export function imageStorageClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ImageStorageClient | null {
  const apiUrl = env.MASAR_API_URL?.trim();
  const token = env.MASAR_SYNC_TOKEN?.trim();
  if (!apiUrl || !token) return null;
  return createImageStorageClient({ apiUrl, token });
}

/**
 * Scene saves only externalise images when the local API is serving a premium
 * sync mirror. The free offline workspace keeps embedded images.
 */
export function premiumImageClient(
  env: NodeJS.ProcessEnv = process.env,
): ImageStorageClient | null {
  if (!env.MASAR_SYNC_SCOPE?.trim()) return null;
  return imageStorageClientFromEnv(env);
}

/** Best-effort cleanup; local saves and deletes must not depend on the network. */
export async function removeSceneImages(
  images: SceneImageStorage | null,
  imageIds: Iterable<string>,
): Promise<void> {
  if (!images) return;
  const unique = new Set(imageIds);
  for (const imageId of unique) {
    try {
      await images.remove(imageId);
    } catch (error) {
      console.warn(`[masar] could not delete image ${imageId}`, error);
    }
  }
}

/** Union of image ids recorded in a board's whiteboard scene and metadata. */
export function sceneImageIds(scene: string | null | undefined): Set<string> {
  return new Set(collectSceneImageIds(scene));
}
