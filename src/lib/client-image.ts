import { ClientApiError } from "@/lib/client-api";
import {
  checkImageBytes,
  MAX_IMAGE_UPLOAD_BYTES,
  type SupportedImageMime,
} from "@/lib/image-file";

/**
 * Renderer-side image upload helpers. The backend repeats every check; these
 * only provide immediate feedback and normalize the declared MIME type to the
 * format detected from the bytes.
 */

export type ImageFileValidation =
  | { ok: true; file: File; contentType: SupportedImageMime }
  | { ok: false; message: string; status: 413 | 415 | 422 };

/** Read enough of the file to detect its real image format. */
const INSPECTION_BYTES = 256 * 1024;

export async function validateImageFile(
  file: File,
): Promise<ImageFileValidation> {
  if (file.size === 0) {
    return { ok: false, message: "The selected file is empty.", status: 422 };
  }
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return {
      ok: false,
      message: "This image is too large to upload.",
      status: 413,
    };
  }

  let head: Uint8Array;
  try {
    head = new Uint8Array(
      await file.slice(0, INSPECTION_BYTES).arrayBuffer(),
    );
  } catch {
    return {
      ok: false,
      message: "This file could not be read.",
      status: 422,
    };
  }

  const check = checkImageBytes(head, file.type);
  if (!check.ok) {
    return { ok: false, message: check.message, status: check.status };
  }

  const normalized =
    file.type === check.contentType
      ? file
      : new File([file], file.name, {
          type: check.contentType,
          lastModified: file.lastModified,
        });
  return { ok: true, file: normalized, contentType: check.contentType };
}

interface UploadResponse {
  image?: { id?: string };
  error?: string;
}

export interface UploadedImage {
  imageId: string;
  file: File;
  contentType: SupportedImageMime;
}

/**
 * Upload one validated image to the local image proxy. Validation errors are
 * never converted into a storage-unavailable fallback by the caller.
 */
export async function uploadImageFile(
  file: File,
  kind: "whiteboard" | "note" | "task" | "general",
): Promise<UploadedImage> {
  const validation = await validateImageFile(file);
  if (!validation.ok) {
    throw new ClientApiError(validation.message, validation.status);
  }

  const form = new FormData();
  form.append("file", validation.file);
  form.append("kind", kind);

  let response: Response;
  try {
    response = await fetch("/api/images", {
      method: "POST",
      body: form,
      cache: "no-store",
    });
  } catch {
    throw new ClientApiError(
      "Could not reach image storage. Check your connection.",
      502,
    );
  }

  let payload: UploadResponse | null = null;
  try {
    payload = (await response.json()) as UploadResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new ClientApiError(
      payload?.error ?? `Image upload failed (${response.status}).`,
      response.status,
    );
  }

  const imageId = payload?.image?.id;
  if (!imageId) {
    throw new ClientApiError("Image upload returned no id.", 502);
  }

  return {
    imageId,
    file: validation.file,
    contentType: validation.contentType,
  };
}

/**
 * True when premium image storage cannot be used right now, so callers may
 * keep working with an embedded image. Validation failures (415/422) and
 * oversized uploads are deliberately excluded.
 */
export function isImageStorageUnavailable(error: unknown): boolean {
  if (!(error instanceof ClientApiError)) return false;
  return [401, 402, 404, 409, 502, 503, 504].includes(error.status);
}
