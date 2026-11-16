import { ClientApiError } from "@/lib/client-api";
import {
  checkImageBytes,
  isSupportedImageMime,
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

export type ImageUploadProgressPhase = "uploading" | "processing";

export interface ImageUploadProgress {
  /** `uploading` measures bytes sent to the local API; `processing` waits
   * for the Premium API (and R2) to accept the image. */
  phase: ImageUploadProgressPhase;
  /** 0..1 while uploading, `null` while processing. */
  fraction: number | null;
}

export interface UploadImageOptions {
  onProgress?: (progress: ImageUploadProgress) => void;
}

const UPLOAD_TIMEOUT_MS = 60_000;

interface UploadTransportResult {
  ok: boolean;
  status: number;
  payload: UploadResponse | null;
}

function parseUploadPayload(text: string): UploadResponse | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as UploadResponse;
  } catch {
    return null;
  }
}

/**
 * Send the multipart upload with progress when the platform supports XHR.
 * Fetch cannot report request-body progress, so the upload widget would have
 * nothing to animate otherwise.
 */
function sendImageUpload(
  form: FormData,
  onProgress?: (progress: ImageUploadProgress) => void,
): Promise<UploadTransportResult> {
  if (typeof XMLHttpRequest === "undefined") {
    return fetch("/api/images", {
      method: "POST",
      body: form,
      cache: "no-store",
    })
      .then(async (response) => ({
        ok: response.ok,
        status: response.status,
        payload: parseUploadPayload(await response.text()),
      }))
      .catch(() => {
        throw new ClientApiError(
          "Could not reach image storage. Check your connection.",
          502,
        );
      });
  }

  return new Promise<UploadTransportResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/images");
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    let lastFraction = -1;

    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable || event.total <= 0) return;
      const fraction = Math.min(1, Math.max(0, event.loaded / event.total));
      // Coalesce tiny progress events so the dock and its live region do not
      // re-render for every network chunk.
      if (fraction < 1 && fraction - lastFraction < 0.05) return;
      lastFraction = fraction;
      onProgress({ phase: "uploading", fraction });
    };
    xhr.upload.onload = () => {
      onProgress?.({ phase: "processing", fraction: null });
    };
    xhr.onerror = () => {
      reject(
        new ClientApiError(
          "Could not reach image storage. Check your connection.",
          502,
        ),
      );
    };
    xhr.ontimeout = () => {
      reject(new ClientApiError("Image upload took too long to finish.", 502));
    };
    xhr.onload = () => {
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        payload: parseUploadPayload(xhr.responseText),
      });
    };
    xhr.send(form);
  });
}

/**
 * Upload one validated image to the local image proxy. Validation errors are
 * never converted into a storage-unavailable fallback by the caller.
 */
export async function uploadImageFile(
  file: File,
  kind: "whiteboard" | "note" | "task" | "general",
  options: UploadImageOptions = {},
): Promise<UploadedImage> {
  const validation = await validateImageFile(file);
  if (!validation.ok) {
    throw new ClientApiError(validation.message, validation.status);
  }

  const form = new FormData();
  form.append("file", validation.file);
  form.append("kind", kind);

  const result = await sendImageUpload(form, options.onProgress);
  if (!result.ok) {
    throw new ClientApiError(
      result.payload?.error ?? `Image upload failed (${result.status}).`,
      result.status,
    );
  }

  const imageId = result.payload?.image?.id;
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
 * Decode an embedded image data URL into a File so it can be retried through
 * the normal upload path. Embedded images are produced by the free/offline
 * fallback; keeping this conversion client-side avoids sending the data URL
 * through JSON endpoints.
 */
export async function dataUrlToFile(
  dataUrl: string,
  name = "embedded-image",
): Promise<File> {
  let blob: Blob;
  try {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error("Could not read the image data.");
    blob = await response.blob();
  } catch {
    throw new ClientApiError("Could not read the embedded image.", 422);
  }
  return new File([blob], name, {
    type: blob.type || "application/octet-stream",
  });
}

/** True when `value` is an embedded supported-image data URL. */
export function isSupportedImageDataUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("data:")) return false;
  const comma = value.indexOf(",");
  if (comma < 5) return false;
  const mime = value.slice(5, comma).split(";", 1)[0]?.trim().toLowerCase();
  return isSupportedImageMime(mime);
}

/** A stable, human-readable file name for an embedded image data URL. */
export function embeddedImageFileName(contentType: string): string {
  const extension =
    contentType === "image/jpeg"
      ? "jpg"
      : contentType === "image/svg+xml"
        ? "svg"
        : contentType.split("/", 2)[1] || "png";
  return `embedded-image.${extension}`;
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
