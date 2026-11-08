import { describe, expect, it } from "vitest";

import {
  blobToDataUrl,
  hydrateSceneFiles,
  type SceneFileCacheReader,
} from "@/lib/whiteboard-image-hydration";

const PNG = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" });

function files(entries: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entries).map(([fileId, dataURL]) => [
      fileId,
      { id: fileId, mimeType: "image/png", dataURL, created: 1 },
    ]),
  );
}

function cachedReader(cached: Record<string, Blob | null>): SceneFileCacheReader {
  return {
    cached: async (boardId: string, fileId: string) => {
      expect(boardId).toBe("board-a");
      return cached[fileId] ?? null;
    },
  };
}

describe("whiteboard image hydration", () => {
  it("converts blobs to data URLs without FileReader", async () => {
    const dataURL = await blobToDataUrl(PNG);
    expect(dataURL).toBe("data:image/png;base64,AQIDBA==");
  });

  it("serves cached copies and records every reference", async () => {
    const result = await hydrateSceneFiles(
      "board-a",
      files({ "file-a": "masar://img-1", "file-b": "masar://img-2" }),
      cachedReader({ "file-a": PNG }),
    );

    expect([...result.references.entries()]).toEqual([
      ["file-a", "img-1"],
      ["file-b", "img-2"],
    ]);
    expect([...result.cachedFileIds]).toEqual(["file-a"]);
    expect(
      (result.files["file-a"] as { dataURL: string }).dataURL,
    ).toBe("data:image/png;base64,AQIDBA==");
    // The uncached file keeps its reference for the remote fill phase.
    expect(
      (result.files["file-b"] as { dataURL: string }).dataURL,
    ).toBe("masar://img-2");
  });

  it("keeps references when the cache read fails", async () => {
    const result = await hydrateSceneFiles(
      "board-a",
      files({ "file-a": "masar://img-1" }),
      {
        cached: async () => {
          throw new Error("boom");
        },
      },
    );
    expect([...result.references.entries()]).toEqual([["file-a", "img-1"]]);
    expect(result.cachedFileIds.size).toBe(0);
  });

  it("leaves embedded files and malformed entries untouched", async () => {
    const embedded = "data:image/png;base64,cG5n";
    const result = await hydrateSceneFiles(
      "board-a",
      {
        ...files({ "file-a": embedded }),
        "file-b": "not-an-object",
      },
      cachedReader({}),
    );
    expect(result.references.size).toBe(0);
    expect((result.files["file-a"] as { dataURL: string }).dataURL).toBe(
      embedded,
    );
    expect(result.files["file-b"]).toBe("not-an-object");
  });
});
