import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { boards, imageCache, projects } from "@/db/schema";
import { eq } from "drizzle-orm";

import { ApiError } from "@/lib/api";
import {
  deleteBoardCache,
  getCachedImage,
  getCachedRemoteId,
  putCachedImage,
} from "@/lib/server/image-cache";
import { createBoard, deleteBoard } from "@/lib/server/boards";
import {
  getWhiteboardScene,
  saveWhiteboardScene,
} from "@/lib/server/whiteboards";
import type { RemoteImage, UploadImageInput } from "@/lib/server/images";
import { createTestDatabase, createTestUser, type TestDatabase } from "./helpers/test-db";

let test: TestDatabase;
let owner: { id: string; name: string; email: string };

const PNG_DATA_URL = `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`;

/** A scene whose single image file is embedded. */
function sceneWithFiles(files: Record<string, string>): string {
  return JSON.stringify({
    elements: Object.keys(files).map((fileId) => ({
      id: `element-${fileId}`,
      type: "image",
      fileId,
    })),
    appState: { scrollX: 1 },
    files: Object.fromEntries(
      Object.entries(files).map(([fileId, dataURL]) => [
        fileId,
        { id: fileId, mimeType: "image/png", dataURL, created: 1 },
      ]),
    ),
  });
}

function sceneDataUrls(scene: string): Record<string, string> {
  const parsed = JSON.parse(scene) as {
    files: Record<string, { dataURL: string }>;
  };
  return Object.fromEntries(
    Object.entries(parsed.files).map(([fileId, file]) => [fileId, file.dataURL]),
  );
}

/**
 * Image storage whose uploads stay pending until the test resolves them, so
 * the intermediate state (before an upload completes) can be observed.
 * `resolveAll()` and `failNext()` also apply to uploads that have not been
 * queued yet, so tests cannot race the save flow.
 */
class DeferredImageStorage {
  uploads: UploadImageInput[] = [];
  removed: string[] = [];
  private counter = 0;
  private failure: unknown | null = null;
  private autoResolve = false;
  private pending: Array<() => void> = [];

  async upload(input: UploadImageInput): Promise<RemoteImage> {
    this.uploads.push(input);
    this.counter += 1;
    const id = `image-${this.counter}`;
    return new Promise<RemoteImage>((resolve, reject) => {
      const complete = () => {
        if (this.failure !== null) {
          const failure = this.failure;
          this.failure = null;
          reject(failure);
        } else {
          resolve({
            id,
            kind: "whiteboard",
            contentType: "image/webp",
            byteSize: input.bytes.byteLength,
            width: 32,
            height: 16,
            thumbByteSize: 16,
            thumbWidth: 16,
            thumbHeight: 8,
            createdAt: "2026-06-01T12:00:00.000Z",
          });
        }
      };
      if (this.autoResolve || this.failure !== null) complete();
      else this.pending.push(complete);
    });
  }

  async remove(imageId: string): Promise<void> {
    this.removed.push(imageId);
  }

  /** Resolve every pending (and future) upload. */
  resolveAll(): void {
    this.autoResolve = true;
    for (const complete of this.pending.splice(0)) complete();
  }

  /** Reject the next (pending or future) upload. */
  failNext(error: unknown): void {
    this.failure = error;
    for (const complete of this.pending.splice(0)) complete();
  }

  /** How many uploads are currently awaiting resolution. */
  get pendingCount(): number {
    return this.pending.length;
  }
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

beforeAll(async () => {
  test = await createTestDatabase();
  owner = await createTestUser(test.db, {
    name: "Cache owner",
    email: "cache-owner@example.test",
  });
});

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.db.delete(imageCache);
  await test.db.delete(boards);
  await test.db.delete(projects);
});

async function makeWhiteboard() {
  return createBoard({ name: "Canvas", type: "whiteboard" }, owner.id, test.db);
}

describe("whiteboard image cache", () => {
  it("stores and reads bytes keyed by board and file id", async () => {
    const board = await makeWhiteboard();
    await putCachedImage(
      board.id,
      "file-a",
      { bytes: Buffer.from("bytes-a"), contentType: "image/png" },
      test.db,
    );
    await putCachedImage(
      board.id,
      "file-b",
      { bytes: Buffer.from("bytes-b"), contentType: "image/jpeg" },
      test.db,
    );

    expect(await getCachedImage(board.id, "file-a", test.db)).toEqual({
      bytes: Buffer.from("bytes-a"),
      contentType: "image/png",
    });
    expect(await getCachedImage(board.id, "missing", test.db)).toBeNull();
    expect(await getCachedRemoteId(board.id, "file-a", test.db)).toBeNull();
  });

  it("retains the bytes and the embedded scene while the upload is in flight", async () => {
    const board = await makeWhiteboard();
    const images = new DeferredImageStorage();
    const scene = sceneWithFiles({ "file-a": PNG_DATA_URL });

    const savePromise = saveWhiteboardScene(
      board.id,
      scene,
      owner.id,
      test.db,
      images,
    );

    // The scene is durable (embedded) before the upload resolves, and the
    // bytes are already in the local cache.
    await waitFor(async () => {
      const current = await getWhiteboardScene(board.id, owner.id, test.db);
      return current.scene === scene;
    });
    await waitFor(async () => images.pendingCount === 1);
    expect(await getCachedImage(board.id, "file-a", test.db)).toEqual({
      bytes: Buffer.from("png-bytes"),
      contentType: "image/png",
    });

    images.resolveAll();
    const saved = await savePromise;

    expect(sceneDataUrls(saved.scene)).toEqual({ "file-a": "masar://image-1" });
    expect(await getCachedRemoteId(board.id, "file-a", test.db)).toBe(
      "image-1",
    );
  });

  it("remaps an embedded file to its stored reference instead of re-uploading", async () => {
    const board = await makeWhiteboard();
    const images = new DeferredImageStorage();
    const scene = sceneWithFiles({ "file-a": PNG_DATA_URL });

    const firstPromise = saveWhiteboardScene(
      board.id,
      scene,
      owner.id,
      test.db,
      images,
    );
    images.resolveAll();
    const first = await firstPromise;
    expect(sceneDataUrls(first.scene)).toEqual({ "file-a": "masar://image-1" });

    // A stale renderer (or a returning view that loaded the embedded scene
    // before externalisation finished) re-sends the embedded bytes. The cache
    // ledger prevents a duplicate upload and reuses image-1.
    const second = await saveWhiteboardScene(
      board.id,
      scene,
      owner.id,
      test.db,
      images,
    );
    expect(images.uploads).toHaveLength(1);
    expect(sceneDataUrls(second.scene)).toEqual({ "file-a": "masar://image-1" });
  });

  it("keeps the embedded scene and the cache when the upload fails", async () => {
    const board = await makeWhiteboard();
    const images = new DeferredImageStorage();
    const scene = sceneWithFiles({ "file-a": PNG_DATA_URL });

    const savePromise = saveWhiteboardScene(
      board.id,
      scene,
      owner.id,
      test.db,
      images,
    );
    images.failNext(new ApiError("boom", 500));
    const saved = await savePromise;

    // Local-first: the image is retained embedded and cached for a later save.
    expect(saved.scene).toBe(scene);
    expect(await getCachedImage(board.id, "file-a", test.db)).not.toBeNull();
    expect((await getWhiteboardScene(board.id, owner.id, test.db)).scene).toBe(
      scene,
    );
  });

  it("prunes cache rows for files that leave the scene", async () => {
    const board = await makeWhiteboard();
    const images = new DeferredImageStorage();
    const scene = sceneWithFiles({
      "file-a": PNG_DATA_URL,
      "file-b": PNG_DATA_URL,
    });

    const firstPromise = saveWhiteboardScene(
      board.id,
      scene,
      owner.id,
      test.db,
      images,
    );
    images.resolveAll();
    await firstPromise;
    expect(await getCachedImage(board.id, "file-b", test.db)).not.toBeNull();

    const withoutB = sceneWithFiles({ "file-a": PNG_DATA_URL });
    await saveWhiteboardScene(
      board.id,
      withoutB,
      owner.id,
      test.db,
      images,
    );

    expect(await getCachedImage(board.id, "file-a", test.db)).not.toBeNull();
    expect(await getCachedImage(board.id, "file-b", test.db)).toBeNull();
  });

  it("removes cache rows when the board is deleted", async () => {
    const board = await makeWhiteboard();
    await putCachedImage(
      board.id,
      "file-a",
      { bytes: Buffer.from("bytes-a"), contentType: "image/png" },
      test.db,
    );

    await deleteBoard(board.id, owner.id, test.db, new DeferredImageStorage());

    expect(await getCachedImage(board.id, "file-a", test.db)).toBeNull();
    expect(
      await test.db.select().from(imageCache).where(eq(imageCache.boardId, board.id)),
    ).toEqual([]);
  });

  it("commits a scene too large to embed only after externalisation", async () => {
    const board = await makeWhiteboard();
    const images = new DeferredImageStorage();
    const bigBytes = Buffer.alloc(2 * 1024 * 1024, "x");
    const bigDataUrl = `data:image/png;base64,${bigBytes.toString("base64")}`;
    const scene = sceneWithFiles({ "file-a": bigDataUrl });

    const savePromise = saveWhiteboardScene(
      board.id,
      scene,
      owner.id,
      test.db,
      images,
    );
    // The oversized embedded scene must not be committed before the upload.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const during = await getWhiteboardScene(board.id, owner.id, test.db);
    expect(during.scene).not.toBe(scene);

    images.resolveAll();
    const saved = await savePromise;
    expect(sceneDataUrls(saved.scene)).toEqual({ "file-a": "masar://image-1" });
  });

  it("clears cached rows on board deletion even without explicit cleanup", async () => {
    const board = await makeWhiteboard();
    await putCachedImage(
      board.id,
      "file-a",
      { bytes: Buffer.from("bytes-a"), contentType: "image/png" },
      test.db,
    );
    await deleteBoardCache(board.id, test.db);
    expect(await getCachedImage(board.id, "file-a", test.db)).toBeNull();
  });
});
