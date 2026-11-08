import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "@/db";
import { ApiError, handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { requireApiUser } from "@/lib/server/auth";
import {
  deleteCachedImage,
  getCachedImage,
  MAX_CACHED_IMAGE_BYTES,
  putCachedImage,
} from "@/lib/server/image-cache";
import { decodeDataUrl } from "@/lib/server/image-data";
import { imageStorageClientFromEnv } from "@/lib/server/images";
import { requireWhiteboardBoard } from "@/lib/server/whiteboards";
import { imageCachePutSchema, imageUploadSchema } from "@/lib/validation";

const imageIdSchema = z.string().trim().min(1).max(120);
const boardIdSchema = z.string().trim().min(1).max(120);
const fileIdSchema = z.string().trim().min(1).max(160);
const variantSchema = z.enum(["original", "thumb"]).default("original");

/**
 * Shared image storage proxy for the renderer. The Premium API and Cloudflare
 * R2 own every binary; this route only forwards the signed-in session token so
 * the renderer never sees R2 credentials.
 */
export const imageRoutes = new Hono();

function requireImageStorage() {
  const client = imageStorageClientFromEnv();
  if (!client) {
    throw new ApiError(
      "Sign in to premium sync to store and view whiteboard images.",
      409,
    );
  }
  return client;
}

imageRoutes.post("/images", async (c) => {
  try {
    await requireApiUser();
    const client = requireImageStorage();

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw new ApiError("Send the image as multipart/form-data.", 400);
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError('Attach the image as the "file" field.', 422);
    }
    const input = imageUploadSchema.parse({
      kind: form.get("kind") ?? undefined,
    });
    const bytes = new Uint8Array(await file.arrayBuffer());

    const image = await client.upload({
      bytes,
      contentType: file.type,
      filename: file.name,
      kind: input.kind,
    });
    return jsonOk({ image }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
});

imageRoutes.get("/images/:imageId", async (c) => {
  try {
    await requireApiUser();
    const client = requireImageStorage();
    const imageId = imageIdSchema.parse(c.req.param("imageId"));
    const variant = variantSchema.parse(c.req.query("variant") ?? undefined);
    const content = await client.download(imageId, variant);

    return new Response(new Uint8Array(content.bytes), {
      status: 200,
      headers: {
        "Content-Type": content.contentType,
        "Content-Length": String(content.bytes.byteLength),
        // Image ids are immutable, so a loaded canvas may reuse the bytes.
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
});

imageRoutes.delete("/images/:imageId", async (c) => {
  try {
    await requireApiUser();
    const client = requireImageStorage();
    const imageId = imageIdSchema.parse(c.req.param("imageId"));
    await client.remove(imageId);
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
});

/**
 * Local image cache. The renderer retains a copy of every newly added image
 * here before its R2 upload completes, so the image survives navigation and
 * stays visible while the remote copy is unreachable. The copy is removed
 * only once the renderer confirms the remote image is available and
 * displayed (DELETE).
 */
imageRoutes.put("/boards/:boardId/images/:fileId/cache", async (c) => {
  try {
    const user = await requireApiUser();
    requireImageStorage();
    const boardId = boardIdSchema.parse(c.req.param("boardId"));
    const fileId = fileIdSchema.parse(c.req.param("fileId"));
    await requireWhiteboardBoard(getDb(), boardId, user.id);

    const input = await parseJsonBody(c.req.raw, imageCachePutSchema);
    const decoded = decodeDataUrl(input.dataURL);
    if (!decoded) {
      throw new ApiError("The file is not a valid image data URL.", 422);
    }
    if (decoded.bytes.byteLength > MAX_CACHED_IMAGE_BYTES) {
      throw new ApiError("This image is too large to cache locally.", 413);
    }
    await putCachedImage(boardId, fileId, {
      bytes: decoded.bytes,
      contentType: decoded.contentType,
    });
    return jsonOk({ cached: true }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
});

imageRoutes.get("/boards/:boardId/images/:fileId/cache", async (c) => {
  try {
    const user = await requireApiUser();
    const boardId = boardIdSchema.parse(c.req.param("boardId"));
    const fileId = fileIdSchema.parse(c.req.param("fileId"));
    await requireWhiteboardBoard(getDb(), boardId, user.id);

    const cached = await getCachedImage(boardId, fileId);
    if (!cached) {
      throw new ApiError("No local copy of this image.", 404);
    }
    return new Response(new Uint8Array(cached.bytes), {
      status: 200,
      headers: {
        "Content-Type": cached.contentType,
        "Content-Length": String(cached.bytes.byteLength),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
});

imageRoutes.delete("/boards/:boardId/images/:fileId/cache", async (c) => {
  try {
    const user = await requireApiUser();
    const boardId = boardIdSchema.parse(c.req.param("boardId"));
    const fileId = fileIdSchema.parse(c.req.param("fileId"));
    await requireWhiteboardBoard(getDb(), boardId, user.id);

    const removed = await deleteCachedImage(boardId, fileId);
    return jsonOk({ removed });
  } catch (error) {
    return handleRouteError(error);
  }
});
