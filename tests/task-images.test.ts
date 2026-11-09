import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { eq } from "drizzle-orm";

import { getClient, getDb } from "@/db";
import { boards, imageCache, taskImages } from "@/db/schema";
import { createBoard, getBoardDetail } from "@/lib/server/boards";
import { deleteTaskImage, addTaskImage } from "@/lib/server/task-images";
import {
  createTask,
  deleteTask,
  duplicateTask,
  getTaskDetail,
} from "@/lib/server/tasks";
import { putCachedImage } from "@/lib/server/image-cache";
import type { SceneImageStorage } from "@/lib/server/images";
import { getLocalUser, LOCAL_USER_ID } from "@/lib/server/desktop";
import {
  MAX_EMBEDDED_TASK_IMAGE_BYTES,
  MAX_TASK_IMAGES,
  dataUrlByteSize,
  taskImageCacheUrl,
  taskImageUrl,
  taskImageUrlId,
} from "@/lib/task-image";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";
import { pngDataUrl } from "./helpers/image-fixtures";

let test: TestDatabase;

beforeAll(async () => {
  test = await createTestDatabase();
  process.env.DATABASE_URL = test.url;
  getDb();
  await getLocalUser();
});

afterAll(async () => {
  await test.close();
  delete process.env.DATABASE_URL;
});

beforeEach(async () => {
  await test.db.delete(boards);
  const client = getClient();
  await client.execute("delete from projects");
  await client.execute("delete from sync_changes");
});

function dataUrl(bytes: Uint8Array, type = "image/png"): string {
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function makeTask() {
  const board = await createBoard({ name: "Attachments" }, LOCAL_USER_ID, test.db);
  const detail = await getBoardDetail(board.id, LOCAL_USER_ID, test.db);
  const task = await createTask(
    board.id,
    { columnId: detail.columns[0]!.id, title: "Task" },
    LOCAL_USER_ID,
    test.db,
  );
  return { board, task };
}

function fakeImageStorage() {
  const removed: string[] = [];
  const storage: SceneImageStorage = {
    upload: vi.fn(async () => {
      throw new Error("upload is not used by attachment tests");
    }),
    remove: vi.fn(async (imageId: string) => {
      removed.push(imageId);
    }),
  };
  return { storage, removed };
}

describe("task image attachments", () => {
  it("attaches embedded images in order and reports counts", async () => {
    const { board, task } = await makeTask();

    const first = await addTaskImage(
      task.id,
      { dataURL: pngDataUrl(), name: "  before.png  " },
      LOCAL_USER_ID,
      test.db,
    );
    const second = await addTaskImage(
      task.id,
      { dataURL: pngDataUrl(), name: null },
      LOCAL_USER_ID,
      test.db,
    );

    expect(first).toMatchObject({
      taskId: task.id,
      name: "before.png",
      position: 0,
    });
    expect(second).toMatchObject({ name: null, position: 1 });

    const detail = await getTaskDetail(task.id, LOCAL_USER_ID, test.db);
    expect(detail.imageCount).toBe(2);
    expect(detail.images.map((image) => image.id)).toEqual([
      first.id,
      second.id,
    ]);

    const boardDetail = await getBoardDetail(board.id, LOCAL_USER_ID, test.db);
    const listed = boardDetail.tasks.find((row) => row.id === task.id);
    expect(listed?.imageCount).toBe(2);
  });

  it("rejects invalid, missing and oversized embedded images", async () => {
    const { task } = await makeTask();

    await expect(
      addTaskImage(task.id, {}, LOCAL_USER_ID, test.db),
    ).rejects.toMatchObject({ status: 422 });

    await expect(
      addTaskImage(
        task.id,
        { dataURL: "data:text/plain;base64,aGVsbG8=" },
        LOCAL_USER_ID,
        test.db,
      ),
    ).rejects.toMatchObject({ status: 415 });

    await expect(
      addTaskImage(
        task.id,
        { dataURL: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
        LOCAL_USER_ID,
        test.db,
      ),
    ).rejects.toMatchObject({ status: 415 });

    await expect(
      addTaskImage(
        task.id,
        { dataURL: dataUrl(Buffer.from("not an image")) },
        LOCAL_USER_ID,
        test.db,
      ),
    ).rejects.toMatchObject({ status: 422 });

    await expect(
      addTaskImage(
        task.id,
        { dataURL: dataUrl(new Uint8Array(MAX_EMBEDDED_TASK_IMAGE_BYTES + 1)) },
        LOCAL_USER_ID,
        test.db,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("caps the number of images on one task", async () => {
    const { task } = await makeTask();
    const now = new Date();
    await test.db.insert(taskImages).values(
      Array.from({ length: MAX_TASK_IMAGES }, (_, index) => ({
        id: `task-image-${index}`,
        taskId: task.id,
        url: taskImageUrl(`remote-${index}`),
        name: null,
        position: index,
        createdAt: now,
        updatedAt: now,
      })),
    );

    await expect(
      addTaskImage(
        task.id,
        { dataURL: pngDataUrl() },
        LOCAL_USER_ID,
        test.db,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("attaches premium image ids idempotently", async () => {
    const { task } = await makeTask();
    const { storage } = fakeImageStorage();

    const first = await addTaskImage(
      task.id,
      { imageId: "image-1", name: "shot.png" },
      LOCAL_USER_ID,
      test.db,
      storage,
    );
    const retry = await addTaskImage(
      task.id,
      { imageId: "image-1", name: "shot.png" },
      LOCAL_USER_ID,
      test.db,
      storage,
    );

    expect(first.url).toBe("/api/images/image-1");
    expect(retry.id).toBe(first.id);
    const rows = await test.db
      .select()
      .from(taskImages)
      .where(eq(taskImages.taskId, task.id));
    expect(rows).toHaveLength(1);
  });

  it("removes the cache copy and R2 object of an unreferenced image", async () => {
    const { board, task } = await makeTask();
    const { storage, removed } = fakeImageStorage();
    const image = await addTaskImage(
      task.id,
      { imageId: "image-7" },
      LOCAL_USER_ID,
      test.db,
      storage,
    );
    await putCachedImage(
      board.id,
      "image-7",
      { contentType: "image/png", bytes: Buffer.from("cached") },
      test.db,
    );

    await deleteTaskImage(
      task.id,
      image.id,
      LOCAL_USER_ID,
      test.db,
      storage,
    );

    expect(removed).toEqual(["image-7"]);
    const cacheRows = await test.db
      .select()
      .from(imageCache)
      .where(eq(imageCache.fileId, "image-7"));
    expect(cacheRows).toHaveLength(0);
    const detail = await getTaskDetail(task.id, LOCAL_USER_ID, test.db);
    expect(detail.images).toHaveLength(0);
    expect(detail.imageCount).toBe(0);
  });

  it("keeps shared images alive until the last duplicate is deleted", async () => {
    const { board, task } = await makeTask();
    const { storage, removed } = fakeImageStorage();
    const image = await addTaskImage(
      task.id,
      { imageId: "image-9" },
      LOCAL_USER_ID,
      test.db,
      storage,
    );
    const copy = await duplicateTask(task.id, LOCAL_USER_ID, test.db);
    await putCachedImage(
      board.id,
      "image-9",
      { contentType: "image/png", bytes: Buffer.from("cached") },
      test.db,
    );

    expect(copy.images).toHaveLength(1);
    expect(copy.images[0]?.id).not.toBe(image.id);
    expect(copy.images[0]?.url).toBe(image.url);

    await deleteTaskImage(
      task.id,
      image.id,
      LOCAL_USER_ID,
      test.db,
      storage,
    );
    expect(removed).toEqual([]);
    expect(
      await test.db
        .select()
        .from(imageCache)
        .where(eq(imageCache.fileId, "image-9")),
    ).toHaveLength(1);

    await deleteTask(
      copy.id,
      LOCAL_USER_ID,
      test.db,
      storage,
    );
    expect(removed).toEqual(["image-9"]);
    expect(
      await test.db
        .select()
        .from(imageCache)
        .where(eq(imageCache.fileId, "image-9")),
    ).toHaveLength(0);
  });

  it("cleans up attachments when the task itself is deleted", async () => {
    const { task } = await makeTask();
    const { storage, removed } = fakeImageStorage();
    await addTaskImage(
      task.id,
      { imageId: "image-11" },
      LOCAL_USER_ID,
      test.db,
      storage,
    );

    await deleteTask(task.id, LOCAL_USER_ID, test.db, storage);

    expect(removed).toEqual(["image-11"]);
    const detail = await getTaskDetail(task.id, LOCAL_USER_ID, test.db).catch(
      (error: unknown) => error,
    );
    expect(detail).toMatchObject({ status: 404 });
  });
});

describe("task image helpers", () => {
  it("measures base64 and plain data URLs", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(dataUrlByteSize(dataUrl(bytes))).toBe(4);
    expect(
      dataUrlByteSize("data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E"),
    ).toBeGreaterThan(0);
    expect(dataUrlByteSize("not-a-data-url")).toBe(0);
  });

  it("recognizes canonical and cache URLs only", () => {
    expect(taskImageUrl("image-1")).toBe("/api/images/image-1");
    expect(taskImageUrlId("/api/images/image-1")).toBe("image-1");
    expect(taskImageUrlId(taskImageCacheUrl("board-1", "image-1"))).toBe(
      "image-1",
    );
    expect(taskImageUrlId("data:image/png;base64,AAAA")).toBeNull();
    expect(taskImageUrlId("/api/images/")).toBeNull();
  });
});
