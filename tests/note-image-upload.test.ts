import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClientApiError } from "@/lib/client-api";
import { uploadNoteImage } from "@/lib/use-note-images";

vi.mock("@/lib/client-image", () => ({
  validateImageFile: vi.fn(async () => ({ ok: true as const, file: FILE })),
  uploadImageFile: vi.fn(),
  isImageStorageUnavailable: vi.fn(
    (error: unknown) =>
      error instanceof ClientApiError &&
      [401, 402, 404, 409, 502, 503, 504].includes(error.status),
  ),
}));

vi.mock("@/lib/client-api", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    api: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/whiteboard-image-hydration", () => ({
  blobToDataUrl: vi.fn(async () => DATA_URL),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

const FILE = new File(["image-bytes"], "photo.png", { type: "image/png" });
const DATA_URL = "data:image/png;base64,aW1hZ2UtYnl0ZXM=";

import { api } from "@/lib/client-api";
import {
  isImageStorageUnavailable,
  uploadImageFile,
  validateImageFile,
} from "@/lib/client-image";
import { blobToDataUrl } from "@/lib/whiteboard-image-hydration";

describe("uploadNoteImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uploads through shared storage, caches the bytes and returns the canonical URL", async () => {
    vi.mocked(uploadImageFile).mockResolvedValue({
      imageId: "image-1",
      file: FILE,
      contentType: "image/png",
    });

    const url = await uploadNoteImage("board-1", FILE);

    expect(url).toBe("/api/images/image-1");
    // The bytes were cached locally, keyed by the image id.
    expect(api).toHaveBeenCalledWith(
      "/api/boards/board-1/images/image-1/cache",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ dataURL: DATA_URL }),
      }),
    );
  });

  it("still returns the canonical URL when caching the bytes fails", async () => {
    vi.mocked(uploadImageFile).mockResolvedValue({
      imageId: "image-1",
      file: FILE,
      contentType: "image/png",
    });
    vi.mocked(api).mockRejectedValue(new Error("cache down"));

    const url = await uploadNoteImage("board-1", FILE);

    expect(url).toBe("/api/images/image-1");
  });

  it("falls back to an embedded data URL when image storage is unavailable", async () => {
    vi.mocked(uploadImageFile).mockRejectedValue(
      new ClientApiError("Could not reach image storage.", 502),
    );

    const url = await uploadNoteImage("board-1", FILE);

    expect(url).toBe(DATA_URL);
    expect(blobToDataUrl).toHaveBeenCalledWith(FILE);
    // No cache write is attempted for the embedded fallback.
    expect(api).not.toHaveBeenCalled();
    expect(isImageStorageUnavailable).toHaveBeenCalled();
  });

  it("rejects invalid files before any upload is attempted", async () => {
    vi.mocked(validateImageFile).mockResolvedValueOnce({
      ok: false,
      message: "This file could not be read.",
      status: 422,
    });

    await expect(uploadNoteImage("board-1", FILE)).rejects.toThrow(
      "This file could not be read.",
    );
    expect(uploadImageFile).not.toHaveBeenCalled();
    expect(blobToDataUrl).not.toHaveBeenCalled();
  });
});
