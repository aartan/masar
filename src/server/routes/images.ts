import { Hono } from "hono";
import { z } from "zod";

import { ApiError, handleRouteError, jsonOk } from "@/lib/api";
import { requireApiUser } from "@/lib/server/auth";
import { imageStorageClientFromEnv } from "@/lib/server/images";
import { imageUploadSchema } from "@/lib/validation";

const imageIdSchema = z.string().trim().min(1).max(120);
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
