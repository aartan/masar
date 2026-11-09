/**
 * Shared image upload policy for the renderer and the local API.
 *
 * Only raster formats that the Premium image processor can decode and
 * re-encode are accepted. The declared MIME type is checked for a supported
 * image family, but the file bytes are always sniffed and the detected format
 * is authoritative. File extensions are never used for validation.
 */

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
] as const;

export type SupportedImageMime = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export const SUPPORTED_IMAGE_FORMATS_LABEL =
  "PNG, JPEG, GIF, WebP or AVIF";

export const IMAGE_ACCEPT = SUPPORTED_IMAGE_MIME_TYPES.join(",");

export const UNSUPPORTED_IMAGE_MESSAGE =
  `Unsupported file type. Only ${SUPPORTED_IMAGE_FORMATS_LABEL} images are allowed.`;

export const INVALID_IMAGE_MESSAGE =
  `The file is not a valid ${SUPPORTED_IMAGE_FORMATS_LABEL} image.`;

export const EMPTY_IMAGE_MESSAGE = "The selected file is empty.";

/** Largest file the local API will read before rejecting it. */
export const MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024;

export type ImageValidationCode =
  | "unsupported_image_type"
  | "invalid_image"
  | "empty_image"
  | "image_too_large";

export type ImageCheckResult =
  | { ok: true; contentType: SupportedImageMime }
  | {
      ok: false;
      code: ImageValidationCode;
      message: string;
      status: 413 | 415 | 422;
    };

const MIME_ALIASES: Record<string, SupportedImageMime> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
};

const SUPPORTED_MIME = new Set<string>(SUPPORTED_IMAGE_MIME_TYPES);

/** Normalize a declared content type, mapping common aliases. */
export function normalizeImageMime(value: string | null | undefined): string {
  const normalized =
    value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return MIME_ALIASES[normalized] ?? normalized;
}

export function isSupportedImageMime(
  value: unknown,
): value is SupportedImageMime {
  return (
    typeof value === "string" && SUPPORTED_MIME.has(normalizeImageMime(value))
  );
}

function at(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? 0;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let value = "";
  for (let index = start; index < end; index += 1) {
    value += String.fromCharCode(at(bytes, index));
  }
  return value;
}

function u16be(bytes: Uint8Array, offset: number): number {
  return (at(bytes, offset) << 8) | at(bytes, offset + 1);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    ((at(bytes, offset) << 24) |
      (at(bytes, offset + 1) << 16) |
      (at(bytes, offset + 2) << 8) |
      at(bytes, offset + 3)) >>>
    0
  );
}

function u16le(bytes: Uint8Array, offset: number): number {
  return at(bytes, offset) | (at(bytes, offset + 1) << 8);
}

function hasPngHeader(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 33 &&
    at(bytes, 0) === 0x89 &&
    at(bytes, 1) === 0x50 &&
    at(bytes, 2) === 0x4e &&
    at(bytes, 3) === 0x47 &&
    at(bytes, 4) === 0x0d &&
    at(bytes, 5) === 0x0a &&
    at(bytes, 6) === 0x1a &&
    at(bytes, 7) === 0x0a &&
    ascii(bytes, 12, 16) === "IHDR" &&
    u32be(bytes, 16) > 0 &&
    u32be(bytes, 20) > 0
  );
}

function hasJpegHeader(bytes: Uint8Array): boolean {
  if (
    bytes.length < 4 ||
    at(bytes, 0) !== 0xff ||
    at(bytes, 1) !== 0xd8 ||
    at(bytes, 2) !== 0xff
  ) {
    return false;
  }

  // Walk the marker segments until a Start Of Frame segment is found. This
  // rejects files that only contain the two-byte SOI marker.
  let offset = 2;
  const limit = Math.min(bytes.length, 256 * 1024);
  while (offset + 3 < limit) {
    if (at(bytes, offset) !== 0xff) return false;
    while (offset < limit && at(bytes, offset) === 0xff) offset += 1;
    const marker = at(bytes, offset);
    offset += 1;

    // Standalone markers.
    if (
      marker === 0x01 ||
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      if (marker === 0xd9) return false;
      continue;
    }

    if (offset + 1 >= limit) return false;
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > limit) return false;

    // SOF0..SOF15, excluding DHT (C4), JPG (C8) and DAC (CC).
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isStartOfFrame) {
      return length >= 7 && u16be(bytes, offset + 3) > 0 && u16be(bytes, offset + 5) > 0;
    }
    offset += length;
  }
  return false;
}

function hasGifHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 13) return false;
  const signature = ascii(bytes, 0, 6);
  return (
    (signature === "GIF87a" || signature === "GIF89a") &&
    u16le(bytes, 6) > 0 &&
    u16le(bytes, 8) > 0
  );
}

function hasWebpHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 20) return false;
  const chunk = ascii(bytes, 12, 16);
  return (
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP" &&
    (chunk === "VP8 " || chunk === "VP8L" || chunk === "VP8X")
  );
}

function ftypBrands(bytes: Uint8Array): string[] | null {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== "ftyp") return null;
  const boxSize = u32be(bytes, 0);
  if (boxSize < 16) return null;

  const brands: string[] = [ascii(bytes, 8, 12)];
  const end = Math.min(boxSize, bytes.length);
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    brands.push(ascii(bytes, offset, offset + 4));
  }
  return brands;
}

function hasAvifHeader(bytes: Uint8Array): boolean {
  const brands = ftypBrands(bytes);
  return Boolean(
    brands?.some((brand) => brand === "avif" || brand === "avis"),
  );
}

/** The supported MIME type detected from the bytes, or null. */
export function detectImageMime(
  bytes: Uint8Array,
): SupportedImageMime | null {
  if (hasPngHeader(bytes)) return "image/png";
  if (hasJpegHeader(bytes)) return "image/jpeg";
  if (hasGifHeader(bytes)) return "image/gif";
  if (hasWebpHeader(bytes)) return "image/webp";
  if (hasAvifHeader(bytes)) return "image/avif";
  return null;
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(
    bytes.subarray(0, 1024),
  );
  const normalized = head.replace(/^\uFEFF/, "").trimStart().toLowerCase();
  if (normalized.startsWith("<svg")) return true;
  if (
    normalized.startsWith("<?xml") ||
    normalized.startsWith("<!--") ||
    normalized.startsWith("<!doctype")
  ) {
    return normalized.includes("<svg");
  }
  return false;
}

/**
 * Identify well-known non-supported image formats so they can be rejected as
 * unsupported rather than as malformed files.
 */
export function detectUnsupportedImageType(
  bytes: Uint8Array,
): string | null {
  if (looksLikeSvg(bytes)) return "SVG";
  if (ascii(bytes, 0, 2) === "BM") return "BMP";
  if (
    ascii(bytes, 0, 4) === "II*\0" ||
    ascii(bytes, 0, 4) === "MM\0*"
  ) {
    return "TIFF";
  }
  if (
    at(bytes, 0) === 0x00 &&
    at(bytes, 1) === 0x00 &&
    at(bytes, 2) === 0x01 &&
    at(bytes, 3) === 0x00
  ) {
    return "ICO";
  }
  if (ascii(bytes, 0, 4) === "%PDF") return "PDF";

  const brands = ftypBrands(bytes);
  if (
    brands?.some((brand) =>
      ["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"].includes(
        brand,
      ),
    )
  ) {
    return "HEIF/HEIC";
  }
  return null;
}

/**
 * Validate a file against the upload policy.
 *
 * `declaredContentType` may be empty or `application/octet-stream` when the
 * browser could not determine it; in that case the sniffed format is used.
 * When it is a non-image or unsupported image type the upload is rejected
 * even if the bytes happen to contain a valid image.
 */
export function checkImageBytes(
  bytes: Uint8Array,
  declaredContentType?: string | null,
): ImageCheckResult {
  if (bytes.byteLength === 0) {
    return {
      ok: false,
      code: "empty_image",
      message: EMPTY_IMAGE_MESSAGE,
      status: 422,
    };
  }

  if (bytes.byteLength > MAX_IMAGE_UPLOAD_BYTES) {
    return {
      ok: false,
      code: "image_too_large",
      message: "This image is too large to upload.",
      status: 413,
    };
  }

  const declared = normalizeImageMime(declaredContentType);
  if (
    declared &&
    declared !== "application/octet-stream" &&
    !isSupportedImageMime(declared)
  ) {
    return {
      ok: false,
      code: "unsupported_image_type",
      message: UNSUPPORTED_IMAGE_MESSAGE,
      status: 415,
    };
  }

  const detected = detectImageMime(bytes);
  if (detected) return { ok: true, contentType: detected };

  if (detectUnsupportedImageType(bytes)) {
    return {
      ok: false,
      code: "unsupported_image_type",
      message: UNSUPPORTED_IMAGE_MESSAGE,
      status: 415,
    };
  }

  return {
    ok: false,
    code: "invalid_image",
    message: INVALID_IMAGE_MESSAGE,
    status: 422,
  };
}
