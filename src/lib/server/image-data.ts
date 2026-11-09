import { ApiError } from "@/lib/api";
import {
  checkImageBytes,
  EMPTY_IMAGE_MESSAGE,
  isSupportedImageMime,
  normalizeImageMime,
  UNSUPPORTED_IMAGE_MESSAGE,
} from "@/lib/image-file";
import { parseNoteDocument } from "@/lib/note-document";
import { parseSceneDocument } from "@/lib/whiteboard-scene";

export interface DecodedImage {
  bytes: Buffer;
  contentType: string;
}

type ParsedImageDataUrl =
  | {
      ok: true;
      bytes: Buffer;
      declaredContentType: string;
    }
  | {
      ok: false;
      status: 415 | 422;
      message: string;
    };

export function parseImageDataUrl(value: unknown): ParsedImageDataUrl {
  if (typeof value !== "string" || !value.startsWith("data:")) {
    return {
      ok: false,
      status: 422,
      message: "The file is not a valid image data URL.",
    };
  }
  const comma = value.indexOf(",");
  if (comma < 5) {
    return {
      ok: false,
      status: 422,
      message: "The file is not a valid image data URL.",
    };
  }

  const metadata = value.slice(5, comma);
  const parts = metadata.split(";");
  const declaredContentType = normalizeImageMime(parts[0]);
  if (
    !declaredContentType ||
    !declaredContentType.startsWith("image/") ||
    !isSupportedImageMime(declaredContentType)
  ) {
    return {
      ok: false,
      status: 415,
      message: UNSUPPORTED_IMAGE_MESSAGE,
    };
  }

  const base64 = parts
    .slice(1)
    .some((part) => part.trim().toLowerCase() === "base64");

  try {
    const payload = value.slice(comma + 1);
    const bytes = base64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    if (bytes.byteLength === 0) {
      return { ok: false, status: 422, message: EMPTY_IMAGE_MESSAGE };
    }
    return { ok: true, bytes, declaredContentType };
  } catch {
    return {
      ok: false,
      status: 422,
      message: "The file is not a valid image data URL.",
    };
  }
}

/**
 * Decode a supported-image data URL without validating its bytes. Production
 * persistence paths use `decodeVerifiedImageDataUrl`; this compatibility
 * helper remains for callers that only need the declared envelope.
 */
export function decodeDataUrl(value: unknown): DecodedImage | null {
  const parsed = parseImageDataUrl(value);
  if (!parsed.ok) return null;
  return { bytes: parsed.bytes, contentType: parsed.declaredContentType };
}

/**
 * Decode and verify an image data URL. The returned content type comes from
 * the file bytes, never from the declared MIME type.
 */
export function decodeVerifiedImageDataUrl(value: unknown): DecodedImage {
  const parsed = parseImageDataUrl(value);
  if (!parsed.ok) {
    throw new ApiError(parsed.message, parsed.status);
  }

  const check = checkImageBytes(parsed.bytes, parsed.declaredContentType);
  if (!check.ok) {
    throw new ApiError(check.message, check.status);
  }
  return { bytes: parsed.bytes, contentType: check.contentType };
}

/** Validate uploaded bytes and return the sniffed content type. */
export function verifyImageBytes(
  bytes: Uint8Array,
  declaredContentType: string | null | undefined,
): DecodedImage {
  const check = checkImageBytes(bytes, declaredContentType);
  if (!check.ok) {
    throw new ApiError(check.message, check.status);
  }
  return { bytes: Buffer.from(bytes), contentType: check.contentType };
}

function labelled(message: string, label: string): string {
  return `${label}: ${message}`;
}

/** Reject unsupported embedded files before a whiteboard scene is saved. */
export function validateSceneEmbeddedImages(scene: string): void {
  const document = parseSceneDocument(scene);
  if (!document) return;

  for (const [fileId, file] of Object.entries(document.files)) {
    const dataURL = file.dataURL;
    if (typeof dataURL !== "string" || !dataURL.startsWith("data:")) continue;
    try {
      decodeVerifiedImageDataUrl(dataURL);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new ApiError(
          labelled(error.message, `Image file "${fileId}"`),
          error.status,
        );
      }
      throw error;
    }
  }
}

function walkNoteBlock(
  block: Record<string, unknown>,
  onUrl: (url: string) => void,
): void {
  const props = block.props;
  if (props && typeof props === "object" && !Array.isArray(props)) {
    const url = (props as Record<string, unknown>).url;
    if (typeof url === "string") onUrl(url);
  }
  const content = block.content;
  if (Array.isArray(content)) {
    for (const child of content) {
      if (child && typeof child === "object" && !Array.isArray(child)) {
        walkNoteBlock(child as Record<string, unknown>, onUrl);
      }
    }
  }
}

/** Reject unsupported embedded files before a note document is saved. */
export function validateNoteEmbeddedImages(document: string): void {
  const blocks = parseNoteDocument(document);
  if (!blocks) return;

  for (const block of blocks) {
    walkNoteBlock(block, (url) => {
      if (!url.startsWith("data:")) return;
      try {
        decodeVerifiedImageDataUrl(url);
      } catch (error) {
        if (error instanceof ApiError) {
          throw new ApiError(
            labelled(
              error.message,
              `Note image${typeof block.id === "string" ? ` "${block.id}"` : ""}`,
            ),
            error.status,
          );
        }
        throw error;
      }
    });
  }
}
