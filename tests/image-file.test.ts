import { describe, expect, it } from "vitest";

import {
  checkImageBytes,
  detectImageMime,
  isSupportedImageMime,
  normalizeImageMime,
} from "@/lib/image-file";
import { PNG_BYTES } from "./helpers/image-fixtures";

const GIF_BYTES = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  "base64",
);

function jpegHeader(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, // APP0, length 16
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, // SOF0, length 17
    0x08, 0x00, 0x01, 0x00, 0x01, 0x03, // precision, height, width, components
    0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
}

function webpHeader(): Uint8Array {
  return new Uint8Array([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x1a, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50, // WEBP
    0x56, 0x50, 0x38, 0x20, // VP8
    0x0e, 0x00, 0x00, 0x00,
  ]);
}

function avifHeader(): Uint8Array {
  return new Uint8Array([
    0x00, 0x00, 0x00, 0x18, // box size 24
    0x66, 0x74, 0x79, 0x70, // ftyp
    0x61, 0x76, 0x69, 0x66, // avif
    0x00, 0x00, 0x00, 0x00,
    0x61, 0x76, 0x69, 0x66, // compatible avif
    0x6d, 0x69, 0x66, 0x31, // compatible mif1
    0x00, 0x00, 0x00, 0x00,
  ]);
}

describe("image upload policy", () => {
  it("detects supported formats from content", () => {
    expect(detectImageMime(PNG_BYTES)).toBe("image/png");
    expect(detectImageMime(jpegHeader())).toBe("image/jpeg");
    expect(detectImageMime(GIF_BYTES)).toBe("image/gif");
    expect(detectImageMime(webpHeader())).toBe("image/webp");
    expect(detectImageMime(avifHeader())).toBe("image/avif");
  });

  it("normalizes MIME aliases", () => {
    expect(normalizeImageMime("image/jpg")).toBe("image/jpeg");
    expect(normalizeImageMime("IMAGE/PNG; charset=binary")).toBe("image/png");
    expect(isSupportedImageMime("image/webp")).toBe(true);
    expect(isSupportedImageMime("image/svg+xml")).toBe(false);
    expect(isSupportedImageMime("image/bmp")).toBe(false);
  });

  it("trusts sniffed content among supported image types", () => {
    expect(checkImageBytes(GIF_BYTES, "image/png")).toMatchObject({
      ok: true,
      contentType: "image/gif",
    });
    expect(checkImageBytes(PNG_BYTES, "application/octet-stream")).toMatchObject(
      { ok: true, contentType: "image/png" },
    );
  });

  it("rejects unsupported declared types", () => {
    expect(checkImageBytes(PNG_BYTES, "text/html")).toMatchObject({
      ok: false,
      status: 415,
    });
    expect(checkImageBytes(PNG_BYTES, "image/svg+xml")).toMatchObject({
      ok: false,
      status: 415,
    });
  });

  it("rejects unsupported content even when it is a valid image", () => {
    expect(
      checkImageBytes(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
        "application/octet-stream",
      ),
    ).toMatchObject({ ok: false, status: 415 });
    expect(checkImageBytes(Buffer.from("BMxxxx"), "image/bmp")).toMatchObject({
      ok: false,
      status: 415,
    });
  });

  it("rejects spoofed and empty files", () => {
    expect(checkImageBytes(Buffer.from("not an image"), "image/png")).toMatchObject(
      { ok: false, status: 422 },
    );
    expect(checkImageBytes(Buffer.alloc(0), "image/png")).toMatchObject({
      ok: false,
      status: 422,
    });
  });
});
