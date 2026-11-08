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

function uploadBody(): FormData {
  const form = new FormData();
  form.append(
    "file",
    new File([new Uint8Array([1, 2, 3, 4])], "pixel.png", {
      type: "image/png",
    }),
  );
  form.append("kind", "whiteboard");
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

  const DATA_URL = `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`;

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
      new Uint8Array(Buffer.from("png-bytes")),
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
