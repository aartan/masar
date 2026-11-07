import { Hono } from "hono";

import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { requireApiUser } from "@/lib/server/auth";
import {
  archiveProject,
  createProject,
  deleteProject,
  getProjectDeletionSummary,
  getProjectDetail,
  listProjects,
  reorderProjects,
  restoreProject,
  updateProject,
} from "@/lib/server/projects";
import {
  deleteProjectSchema,
  projectCreateSchema,
  projectUpdateSchema,
  reorderProjectsSchema,
} from "@/lib/validation";

export const projectRoutes = new Hono();

projectRoutes.get("/projects", async (_c) => {
  try {
    const user = await requireApiUser();
    return jsonOk({ projects: await listProjects(user.id) });
  } catch (error) {
    return handleRouteError(error);
  }
});

projectRoutes.post("/projects", async (c) => {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(c.req.raw, projectCreateSchema);
    return jsonOk({ project: await createProject(input, user.id) }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
});

projectRoutes.post("/projects/reorder", async (c) => {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(c.req.raw, reorderProjectsSchema);
    return jsonOk({ projects: await reorderProjects(input.projectIds, user.id) });
  } catch (error) {
    return handleRouteError(error);
  }
});

projectRoutes.get("/projects/:projectId", async (c) => {
  try {
    const user = await requireApiUser();
    return jsonOk({ project: await getProjectDetail(c.req.param("projectId"), user.id) });
  } catch (error) {
    return handleRouteError(error);
  }
});

projectRoutes.patch("/projects/:projectId", async (c) => {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(c.req.raw, projectUpdateSchema);
    return jsonOk({
      project: await updateProject(c.req.param("projectId"), input, user.id),
    });
  } catch (error) {
    return handleRouteError(error);
  }
});

projectRoutes.post("/projects/:projectId/archive", async (c) => {
  try {
    const user = await requireApiUser();
    return jsonOk({ project: await archiveProject(c.req.param("projectId"), user.id) });
  } catch (error) {
    return handleRouteError(error);
  }
});

projectRoutes.post("/projects/:projectId/restore", async (c) => {
  try {
    const user = await requireApiUser();
    return jsonOk({ project: await restoreProject(c.req.param("projectId"), user.id) });
  } catch (error) {
    return handleRouteError(error);
  }
});

projectRoutes.get("/projects/:projectId/deletion-summary", async (c) => {
  try {
    const user = await requireApiUser();
    return jsonOk(
      await getProjectDeletionSummary(c.req.param("projectId"), user.id),
    );
  } catch (error) {
    return handleRouteError(error);
  }
});

projectRoutes.delete("/projects/:projectId", async (c) => {
  try {
    const user = await requireApiUser();
    // The archived project's exact name is required, checked server-side too.
    const input = await parseJsonBody(c.req.raw, deleteProjectSchema);
    await deleteProject(
      c.req.param("projectId"),
      user.id,
      input.confirmation,
    );
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
});
