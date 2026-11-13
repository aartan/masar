import { Hono } from "hono";

import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { requireApiUser } from "@/lib/server/auth";
import {
  createFolder,
  deleteFolder,
  listFolders,
  moveFolder,
  updateFolder,
} from "@/lib/server/folders";
import {
  folderCreateSchema,
  folderUpdateSchema,
  moveFolderSchema,
} from "@/lib/validation";

export const folderRoutes = new Hono();

folderRoutes.get("/folders", async (_c) => {
  try {
    const user = await requireApiUser();
    return jsonOk({ folders: await listFolders(user.id) });
  } catch (error) {
    return handleRouteError(error);
  }
});

folderRoutes.post("/folders", async (c) => {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(c.req.raw, folderCreateSchema);
    return jsonOk({ folder: await createFolder(input, user.id) }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
});

folderRoutes.patch("/folders/:folderId", async (c) => {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(c.req.raw, folderUpdateSchema);
    return jsonOk({
      folder: await updateFolder(c.req.param("folderId"), input, user.id),
    });
  } catch (error) {
    return handleRouteError(error);
  }
});

folderRoutes.post("/folders/:folderId/move", async (c) => {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(c.req.raw, moveFolderSchema);
    return jsonOk({
      folders: await moveFolder(c.req.param("folderId"), input, user.id),
    });
  } catch (error) {
    return handleRouteError(error);
  }
});

folderRoutes.delete("/folders/:folderId", async (c) => {
  try {
    const user = await requireApiUser();
    await deleteFolder(c.req.param("folderId"), user.id);
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
});
