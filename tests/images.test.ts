import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getDb } from "@/db";
import { getLocalUser } from "@/lib/server/desktop";
import { createLocalApp } from "@/server/app";
import { PNG_BYTES, PNG_DATA_URL, pngDataUrl } from "./helpers/image-fixtures";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";

/**
 * The local API is a thin, authenticated proxy to the Premium API. These tests
 * replace global fetch with a fake Premium API so the route contract (multipart
 * upload, image variants, deletion, missing configuration) stays stable without
 * network access or R2 credentials.
 */

const API_URL = "https://sync.example.test";
const TOKEN = "premium-session-token";

const IMAGE = {
  id: "image-1",
  kind: "whiteboard",
  contentType: "image/webp",
  byteSize: 128,
  width: 640,
  height: 360,
  thumbByteSize: 32,
  thumbWidth: 480,
  thumbHeight: 270,
  createdAt: "2026-06-01T12:00:00.000Z",
};

let test: TestDatabase;
let app: ReturnType<typeof createLocalApp>;

beforeAll(async () => {
  test = await createTestDatabase();
  process.env.DATABASE_URL = test.url;
  getDb();
  await getLocalUser();
  app = createLocalApp();
});

afterAll(async () => {
  await test.close();
  delete process.env.DATABASE_URL;
});

beforeEach(() => {
  process.env.MASAR_API_URL = API_URL;
  process.env.MASAR_SYNC_TOKEN = TOKEN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MASAR_API_URL;
  delete process.env.MASAR_SYNC_TOKEN;
});

function request(path: string, init: RequestInit = {}) {
  return app.request(`http://localhost${path}`, init);
}

function uploadBody(
  file = new File([new Uint8Array(PNG_BYTES)], "pixel.png", {
    type: "image/png",
  }),
  kind = "whiteboard",
): FormData {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  return form;
}

function stubFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const mock = vi.fn(
    async (input: string | URL | Request, init: RequestInit = {}) =>
      handler(String(input), init),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("image proxy routes", () => {
  it("uploads multipart images with the premium session token", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    stubFetch((url, init) => {
      calls.push({ url, init });
      return Response.json({ image: IMAGE }, { status: 201 });
    });

    const response = await request("/api/images", {
      method: "POST",
      body: uploadBody(),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ image: IMAGE });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${API_URL}/v1/images`);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
    });

    const form = calls[0]?.init.body as FormData;
    expect(form.get("kind")).toBe("whiteboard");
    const file = form.get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("pixel.png");
    expect((file as File).type).toBe("image/png");
  });

  it("serves original and thumbnail variants", async () => {
    const calls: string[] = [];
    stubFetch((url) => {
      calls.push(url);
      const isThumb = url.endsWith("?variant=thumb");
      return new Response(
        new Uint8Array(isThumb ? [9, 9] : [1, 2, 3, 4]),
        {
          status: 200,
          headers: { "content-type": "image/webp" },
        },
      );
    });

    const original = await request("/api/images/image-1");
    expect(original.status).toBe(200);
    expect(original.headers.get("content-type")).toBe("image/webp");
    expect(original.headers.get("cache-control")).toContain("immutable");
    expect(original.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );

    const thumb = await request("/api/images/image-1?variant=thumb");
    expect(thumb.status).toBe(200);
    expect(new Uint8Array(await thumb.arrayBuffer())).toEqual(
      new Uint8Array([9, 9]),
    );

    expect(calls).toEqual([
      `${API_URL}/v1/images/image-1`,
      `${API_URL}/v1/images/image-1?variant=thumb`,
    ]);
  });

  it("deletes an image", async () => {
    const calls: string[] = [];
    stubFetch((url, init) => {
      calls.push(`${init.method} ${url}`);
      return Response.json({ deleted: true });
    });

    const response = await request("/api/images/image-1", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(calls).toEqual([`DELETE ${API_URL}/v1/images/image-1`]);
  });

  it("responds 409 when premium image storage is not configured", async () => {
    const fetchMock = stubFetch(() => Response.json({}));
    delete process.env.MASAR_API_URL;
    delete process.env.MASAR_SYNC_TOKEN;

    const response = await request("/api/images", {
      method: "POST",
      body: uploadBody(),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("premium sync"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a request without a file before calling the premium API", async () => {
    const fetchMock = stubFetch(() => Response.json({}));

    const response = await request("/api/images", {
      method: "POST",
      body: new FormData(),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("file"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-image uploads before calling the premium API", async () => {
    const fetchMock = stubFetch(() => Response.json({}));

    const html = await request("/api/images", {
      method: "POST",
      body: uploadBody(
        new File(["<html></html>"], "photo.png", {
          type: "text/html",
        }),
      ),
    });
    expect(html.status).toBe(415);

    const svg = await request("/api/images", {
      method: "POST",
      body: uploadBody(
        new File(["<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"], "icon.svg", {
          type: "image/svg+xml",
        }),
      ),
    });
    expect(svg.status).toBe(415);

    const spoofed = await request("/api/images", {
      method: "POST",
      body: uploadBody(
        new File(["not really a png"], "pixel.png", {
          type: "image/png",
        }),
      ),
    });
    expect(spoofed.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the sniffed image type instead of the declared type", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    stubFetch((url, init) => {
      calls.push({ url, init });
      return Response.json({ image: IMAGE }, { status: 201 });
    });

    const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
    const response = await request("/api/images", {
      method: "POST",
      body: uploadBody(
        new File([new Uint8Array(gif)], "pixel.png", {
          type: "image/png",
        }),
      ),
    });

    expect(response.status).toBe(201);
    const forwarded = (calls[0]?.init.body as FormData).get("file");
    expect(forwarded).toBeInstanceOf(File);
    expect((forwarded as File).type).toBe("image/gif");
  });

  it("surfaces premium API errors with their status", async () => {
    stubFetch(() =>
      Response.json(
        { error: "An active subscription is required.", code: "subscription_required" },
        { status: 402 },
      ),
    );

    const response = await request("/api/images", {
      method: "POST",
      body: uploadBody(),
    });

    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      error: "An active subscription is required.",
    });
  });
});

describe("image cache routes", () => {
  async function makeWhiteboard(): Promise<string> {
    const response = await request("/api/boards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Cached canvas", type: "whiteboard" }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { board: { id: string } };
    return body.board.id;
  }

  const DATA_URL = PNG_DATA_URL;

  it("caches, serves and confirms a whiteboard image", async () => {
    const boardId = await makeWhiteboard();

    const put = await request(
      `/api/boards/${boardId}/images/file-a/cache`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataURL: DATA_URL }),
      },
    );
    expect(put.status).toBe(201);

    const get = await request(`/api/boards/${boardId}/images/file-a/cache`);
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(
      new Uint8Array(PNG_BYTES),
    );

    const remove = await request(
      `/api/boards/${boardId}/images/file-a/cache`,
      { method: "DELETE" },
    );
    expect(remove.status).toBe(200);
    expect(await remove.json()).toEqual({ removed: true });

    const missing = await request(`/api/boards/${boardId}/images/file-a/cache`);
    expect(missing.status).toBe(404);
  });

  it("rejects a cache write without premium image storage", async () => {
    const boardId = await makeWhiteboard();
    delete process.env.MASAR_API_URL;
    delete process.env.MASAR_SYNC_TOKEN;

    const response = await request(
      `/api/boards/${boardId}/images/file-a/cache`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataURL: DATA_URL }),
      },
    );
    expect(response.status).toBe(409);

    // Reading is still allowed (it just reports nothing cached).
    const get = await request(`/api/boards/${boardId}/images/file-a/cache`);
    expect(get.status).toBe(404);
  });

  it("caches images for a kanban board carrying task attachments", async () => {
    const created = await request("/api/boards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Task space" }),
    });
    expect(created.status).toBe(201);
    const { board } = (await created.json()) as { board: { id: string } };

    const put = await request(`/api/boards/${board.id}/images/image-1/cache`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataURL: DATA_URL }),
    });
    expect(put.status).toBe(201);

    const get = await request(`/api/boards/${board.id}/images/image-1/cache`);
    expect(get.status).toBe(200);
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(
      new Uint8Array(PNG_BYTES),
    );
  });

  it("rejects malformed payloads and unknown boards", async () => {
    const boardId = await makeWhiteboard();

    const invalid = await request(
      `/api/boards/${boardId}/images/file-a/cache`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataURL: "not-a-data-url" }),
      },
    );
    expect(invalid.status).toBe(422);

    const nonImage = await request(
      `/api/boards/${boardId}/images/file-a/cache`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dataURL: "data:text/plain;base64,aGVsbG8=",
        }),
      },
    );
    expect(nonImage.status).toBe(415);

    const spoofed = await request(
      `/api/boards/${boardId}/images/file-a/cache`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dataURL: `data:image/png;base64,${Buffer.from("not an image").toString("base64")}`,
        }),
      },
    );
    expect(spoofed.status).toBe(422);

    const svg = await request(
      `/api/boards/${boardId}/images/file-a/cache`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dataURL: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
        }),
      },
    );
    expect(svg.status).toBe(415);

    const unknownBoard = await request(
      `/api/boards/nope/images/file-a/cache`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataURL: DATA_URL }),
      },
    );
    expect(unknownBoard.status).toBe(404);
  });
});

describe("task attachment routes", () => {
  async function makeTask(): Promise<{ taskId: string; boardId: string }> {
    const created = await request("/api/boards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Attachment space" }),
    });
    expect(created.status).toBe(201);
    const { board } = (await created.json()) as { board: { id: string } };

    const detailResponse = await request(`/api/boards/${board.id}`);
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as {
      board: { columns: Array<{ id: string }> };
    };

    const taskResponse = await request(`/api/boards/${board.id}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        columnId: detail.board.columns[0]!.id,
        title: "Task with images",
      }),
    });
    expect(taskResponse.status).toBe(201);
    const { task } = (await taskResponse.json()) as { task: { id: string } };
    return { taskId: task.id, boardId: board.id };
  }

  it("attaches an uploaded premium image and removes it", async () => {
    const { taskId } = await makeTask();

    const attach = await request(`/api/tasks/${taskId}/images`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageId: "image-1", name: "shot.png" }),
    });
    expect(attach.status).toBe(201);
    const attached = (await attach.json()) as {
      image: { id: string; url: string; name: string; position: number };
    };
    expect(attached.image).toMatchObject({
      url: "/api/images/image-1",
      name: "shot.png",
      position: 0,
    });

    const detail = await request(`/api/tasks/${taskId}`);
    const body = (await detail.json()) as {
      task: { imageCount: number; images: Array<{ id: string }> };
    };
    expect(body.task.imageCount).toBe(1);
    expect(body.task.images).toHaveLength(1);

    const remove = await request(
      `/api/tasks/${taskId}/images/${attached.image.id}`,
      { method: "DELETE" },
    );
    expect(remove.status).toBe(200);
    expect(await remove.json()).toEqual({ ok: true });

    const after = await request(`/api/tasks/${taskId}`);
    const afterBody = (await after.json()) as {
      task: { imageCount: number; images: unknown[] };
    };
    expect(afterBody.task.imageCount).toBe(0);
    expect(afterBody.task.images).toHaveLength(0);
  });

  it("attaches an embedded data URL in the free workspace", async () => {
    const { taskId } = await makeTask();
    const dataURL = pngDataUrl();

    const attach = await request(`/api/tasks/${taskId}/images`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataURL, name: "free.png" }),
    });
    expect(attach.status).toBe(201);
    const attached = (await attach.json()) as {
      image: { url: string; name: string };
    };
    expect(attached.image).toMatchObject({ url: dataURL, name: "free.png" });
  });

  it("rejects conflicting or invalid image sources", async () => {
    const { taskId } = await makeTask();

    const both = await request(`/api/tasks/${taskId}/images`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageId: "image-1",
        dataURL: pngDataUrl(),
      }),
    });
    expect(both.status).toBe(422);

    const none = await request(`/api/tasks/${taskId}/images`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(none.status).toBe(422);
  });

  it("rejects non-image task attachment data URLs", async () => {
    const { taskId } = await makeTask();

    for (const [dataURL, status] of [
      ["data:text/plain;base64,aGVsbG8=", 422],
      ["data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", 422],
      [pngDataUrl(Buffer.from("not an image")), 422],
    ] as const) {
      const response = await request(`/api/tasks/${taskId}/images`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataURL }),
      });
      expect(response.status).toBe(status);
    }
  });
});
