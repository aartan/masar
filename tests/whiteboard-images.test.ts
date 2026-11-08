import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { boards, images as imagesTable, projects } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { createBoard, deleteBoard } from "@/lib/server/boards";
import {
  createImageStorageClient,
  type RemoteImage,
  type SceneImageStorage,
  type UploadImageInput,
} from "@/lib/server/images";
import {
  archiveProject,
  createProject,
  deleteProject,
} from "@/lib/server/projects";
import {
  getWhiteboardScene,
  saveWhiteboardScene,
} from "@/lib/server/whiteboards";
import { createTestDatabase, createTestUser, type TestDatabase } from "./helpers/test-db";

let test: TestDatabase;
let owner: { id: string; name: string; email: string };

const PNG_DATA_URL = `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`;

class FakeImageStorage implements SceneImageStorage {
  uploads: UploadImageInput[] = [];
  removed: string[] = [];
  failOnUpload = 0;
  failure: unknown = null;
  private counter = 0;

  async upload(input: UploadImageInput): Promise<RemoteImage> {
    if (this.failOnUpload > 0 && this.uploads.length + 1 === this.failOnUpload) {
      throw this.failure ?? new Error("upload failed");
    }
    this.uploads.push(input);
    this.counter += 1;
    return {
      id: `image-${this.counter}`,
      kind: "whiteboard",
      contentType: "image/webp",
      byteSize: 128,
      width: 32,
      height: 16,
      thumbByteSize: 16,
      thumbWidth: 16,
      thumbHeight: 8,
      createdAt: "2026-06-01T12:00:00.000Z",
    };
  }

  async remove(imageId: string): Promise<void> {
    this.removed.push(imageId);
  }
}

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
        {
          id: fileId,
          fileId,
          mimeType: "image/png",
          dataURL,
          created: 1,
        },
      ]),
    ),
  });
}

function sceneDataUrls(scene: string): Record<string, string> {
  const parsed = JSON.parse(scene) as {
    files: Record<string, { dataURL: string }>;
  };
  return Object.fromEntries(
    Object.entries(parsed.files).map(([fileId, file]) => [
      fileId,
      file.dataURL,
    ]),
  );
}

/** Mimic the renderer removing an image element and its file before saving. */
function sceneWithoutFile(scene: string, fileId: string): string {
  const parsed = JSON.parse(scene) as {
    elements: Array<{ fileId?: string }>;
    files: Record<string, unknown>;
  };
  const { [fileId]: _removed, ...files } = parsed.files;
  return JSON.stringify({
    ...parsed,
    elements: parsed.elements.filter((element) => element.fileId !== fileId),
    files,
  });
}

beforeAll(async () => {
  test = await createTestDatabase();
  owner = await createTestUser(test.db, {
    name: "Image owner",
    email: "image-owner@example.test",
  });
});

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.db.delete(imagesTable);
  await test.db.delete(boards);
  await test.db.delete(projects);
});

async function makeWhiteboard(projectId?: string) {
  const board = await createBoard(
    {
      name: "Canvas",
      type: "whiteboard",
      ...(projectId ? { projectId } : {}),
    },
    owner.id,
    test.db,
  );
  return board;
}

describe("whiteboard image externalisation", () => {
  it("uploads embedded images and stores only references in the scene", async () => {
    const board = await makeWhiteboard();
    const images = new FakeImageStorage();
    const scene = sceneWithFiles({ "file-a": PNG_DATA_URL, "file-b": PNG_DATA_URL });

    const saved = await saveWhiteboardScene(
      board.id,
      scene,
      owner.id,
      test.db,
      images,
    );

    expect(images.uploads).toHaveLength(2);
    expect(images.uploads[0]).toMatchObject({
      contentType: "image/png",
      filename: "file-a",
      kind: "whiteboard",
    });
    expect(sceneDataUrls(saved.scene)).toEqual({
      "file-a": "masar://image-1",
      "file-b": "masar://image-2",
    });

    const reloaded = await getWhiteboardScene(board.id, owner.id, test.db);
    expect(sceneDataUrls(reloaded.scene)).toEqual({
      "file-a": "masar://image-1",
      "file-b": "masar://image-2",
    });

    const rows = await test.db
      .select()
      .from(imagesTable)
      .where(eq(imagesTable.boardId, board.id));
    expect(rows.map((row) => row.id).sort()).toEqual(["image-1", "image-2"]);
    expect(rows[0]).toMatchObject({
      kind: "whiteboard",
      contentType: "image/webp",
      width: 32,
      height: 16,
    });
  });

  it("does not re-upload images that are already referenced", async () => {
    const board = await makeWhiteboard();
    const images = new FakeImageStorage();
    const scene = sceneWithFiles({ "file-a": PNG_DATA_URL });

    const first = await saveWhiteboardScene(
      board.id,
      scene,
      owner.id,
      test.db,
      images,
    );
    const second = await saveWhiteboardScene(
      board.id,
      first.scene,
      owner.id,
      test.db,
      images,
    );

    expect(images.uploads).toHaveLength(1);
    expect(images.removed).toEqual([]);
    expect(second.scene).toBe(first.scene);
  });

  it("deletes images removed from the canvas", async () => {
    const board = await makeWhiteboard();
    const images = new FakeImageStorage();

    const first = await saveWhiteboardScene(
      board.id,
      sceneWithFiles({ "file-a": PNG_DATA_URL, "file-b": PNG_DATA_URL }),
      owner.id,
      test.db,
      images,
    );
    const saved = await saveWhiteboardScene(
      board.id,
      sceneWithoutFile(first.scene, "file-b"),
      owner.id,
      test.db,
      images,
    );

    expect(images.uploads).toHaveLength(2);
    expect(images.removed).toEqual(["image-2"]);
    expect(sceneDataUrls(saved.scene)).toEqual({
      "file-a": "masar://image-1",
    });
    const rows = await test.db
      .select()
      .from(imagesTable)
      .where(eq(imagesTable.boardId, board.id));
    expect(rows.map((row) => row.id)).toEqual(["image-1"]);
  });

  it("falls back to embedded images when storage is unavailable", async () => {
    const board = await makeWhiteboard();
    const images = new FakeImageStorage();
    images.failOnUpload = 2;
    images.failure = new ApiError("Image storage is not configured.", 503);
    const scene = sceneWithFiles({ "file-a": PNG_DATA_URL, "file-b": PNG_DATA_URL });

    const saved = await saveWhiteboardScene(
      board.id,
      scene,
      owner.id,
      test.db,
      images,
    );

    expect(saved.scene).toBe(scene);
    expect(images.removed).toEqual(["image-1"]);
    const rows = await test.db.select().from(imagesTable);
    expect(rows).toEqual([]);
  });

  it("retains the image embedded when the remote rejects it", async () => {
    const board = await makeWhiteboard();
    const images = new FakeImageStorage();
    images.failOnUpload = 1;
    images.failure = new ApiError("Unsupported image type.", 415);
    const scene = sceneWithFiles({ "file-a": PNG_DATA_URL });

    // Local-first: a remote rejection must never lose the image. The save
    // keeps the embedded scene and can retry externalisation on a later save.
    const saved = await saveWhiteboardScene(
      board.id,
      scene,
      owner.id,
      test.db,
      images,
    );
    expect(saved.scene).toBe(scene);
    expect(images.removed).toEqual([]);

    const reloaded = await getWhiteboardScene(board.id, owner.id, test.db);
    expect(reloaded.scene).toBe(scene);
  });

  it("keeps embedded images when no premium storage is available", async () => {
    const board = await makeWhiteboard();
    const scene = sceneWithFiles({ "file-a": PNG_DATA_URL });

    const saved = await saveWhiteboardScene(
      board.id,
      scene,
      owner.id,
      test.db,
      null,
    );
    expect(saved.scene).toBe(scene);
  });
});

describe("whiteboard image cleanup", () => {
  it("deletes a board's images using scene references and local metadata", async () => {
    const board = await makeWhiteboard();
    const images = new FakeImageStorage();
    await saveWhiteboardScene(
      board.id,
      sceneWithFiles({ "file-a": PNG_DATA_URL, "file-b": PNG_DATA_URL }),
      owner.id,
      test.db,
      images,
    );

    // Simulate a board synced from another device: the scene has references
    // but this device has no metadata row for one of them.
    await test.db
      .delete(imagesTable)
      .where(eq(imagesTable.id, "image-1"));

    await deleteBoard(board.id, owner.id, test.db, images);
    expect(images.removed.sort()).toEqual(["image-1", "image-2"]);
  });

  it("deletes every image when a project is permanently deleted", async () => {
    const project = await createProject(
      { name: "Image project" },
      owner.id,
      test.db,
    );
    const first = await makeWhiteboard(project.id);
    const second = await makeWhiteboard(project.id);
    const images = new FakeImageStorage();

    await saveWhiteboardScene(
      first.id,
      sceneWithFiles({ "file-a": PNG_DATA_URL }),
      owner.id,
      test.db,
      images,
    );
    await saveWhiteboardScene(
      second.id,
      sceneWithFiles({ "file-b": PNG_DATA_URL }),
      owner.id,
      test.db,
      images,
    );
    await archiveProject(project.id, owner.id, test.db);

    await deleteProject(
      project.id,
      owner.id,
      project.name,
      test.db,
      images,
    );
    expect(images.removed.sort()).toEqual(["image-1", "image-2"]);
  });
});

describe("premium image client", () => {
  it("builds authenticated multipart uploads and reads variants", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/v1/images")) {
        expect(init.headers).toMatchObject({
          Authorization: "Bearer token-1",
        });
        const form = init.body as FormData;
        expect(form.get("kind")).toBe("whiteboard");
        expect(form.get("file")).toBeInstanceOf(File);
        return Response.json(
          {
            image: {
              id: "image-1",
              kind: "whiteboard",
              contentType: "image/webp",
              byteSize: 4,
              width: 2,
              height: 2,
              thumbByteSize: 2,
              thumbWidth: 1,
              thumbHeight: 1,
              createdAt: "2026-06-01T12:00:00.000Z",
            },
          },
          { status: 201 },
        );
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/webp" },
      });
    }) as typeof fetch;

    const client = createImageStorageClient({
      apiUrl: "https://sync.example.test/",
      token: "token-1",
      fetchImpl,
    });

    const uploaded = await client.upload({
      bytes: new Uint8Array(Buffer.from("png-bytes")),
      contentType: "image/png",
      filename: "image.png",
      kind: "whiteboard",
    });
    expect(uploaded.id).toBe("image-1");
    expect(calls[0]?.url).toBe("https://sync.example.test/v1/images");

    const content = await client.download("image-1", "thumb");
    expect([...content.bytes]).toEqual([1, 2, 3]);
    expect(content.contentType).toBe("image/webp");
    expect(calls[1]?.url).toBe(
      "https://sync.example.test/v1/images/image-1?variant=thumb",
    );
  });

  it("tolerates deleting a missing image", async () => {
    const client = createImageStorageClient({
      apiUrl: "https://sync.example.test",
      token: "token-1",
      fetchImpl: (async () =>
        Response.json(
          { error: "Image not found." },
          { status: 404 },
        )) as typeof fetch,
    });

    await expect(client.remove("missing")).resolves.toBeUndefined();
  });
});
