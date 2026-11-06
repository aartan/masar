import { Hono } from "hono";

import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { requireApiUser } from "@/lib/server/auth";
import { getCalendarData } from "@/lib/server/calendar";
import { createComment, deleteComment, listComments } from "@/lib/server/comments";
import { searchTasks } from "@/lib/server/search";
import { getDashboardData } from "@/lib/server/stats";
import {
  createSubtask,
  deleteSubtask,
  listSubtasks,
  updateSubtask,
} from "@/lib/server/subtasks";
import {
  deleteTask,
  duplicateTask,
  getTaskDetail,
  updateTask,
} from "@/lib/server/tasks";
import {
  commentCreateSchema,
  searchQuerySchema,
  subtaskCreateSchema,
  subtaskUpdateSchema,
  taskUpdateSchema,
} from "@/lib/validation";

export const taskRoutes = new Hono();

taskRoutes.get("/dashboard", async (_c) => {
  try {
    const user = await requireApiUser();
    return jsonOk({ dashboard: await getDashboardData(user.id) });
  } catch (error) {
    return handleRouteError(error);
  }
});

taskRoutes.get("/calendar", async (_c) => {
  try {
    const user = await requireApiUser();
    return jsonOk({ calendar: await getCalendarData(user.id) });
  } catch (error) {
    return handleRouteError(error);
  }
});

taskRoutes.get("/search", async (c) => {
  try {
    const user = await requireApiUser();
    const input = searchQuerySchema.parse({ q: c.req.query("q") ?? "" });
    return jsonOk({ results: await searchTasks(user.id, input.q) });
  } catch (error) {
    return handleRouteError(error);
  }
});

taskRoutes.get("/tasks/:taskId", async (c) => {
  try {
    const user = await requireApiUser();
    return jsonOk({ task: await getTaskDetail(c.req.param("taskId"), user.id) });
  } catch (error) {
    return handleRouteError(error);
  }
});

taskRoutes.patch("/tasks/:taskId", async (c) => {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(c.req.raw, taskUpdateSchema);
    return jsonOk({
      task: await updateTask(c.req.param("taskId"), input, user.id),
    });
  } catch (error) {
    return handleRouteError(error);
  }
});

taskRoutes.delete("/tasks/:taskId", async (c) => {
  try {
    const user = await requireApiUser();
    await deleteTask(c.req.param("taskId"), user.id);
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
});

taskRoutes.post("/tasks/:taskId/duplicate", async (c) => {
  try {
    const user = await requireApiUser();
    return jsonOk(
      { task: await duplicateTask(c.req.param("taskId"), user.id) },
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
});

taskRoutes.get("/tasks/:taskId/subtasks", async (c) => {
  try {
    const user = await requireApiUser();
    return jsonOk({
      subtasks: await listSubtasks(c.req.param("taskId"), user.id),
    });
  } catch (error) {
    return handleRouteError(error);
  }
});

taskRoutes.post("/tasks/:taskId/subtasks", async (c) => {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(c.req.raw, subtaskCreateSchema);
    return jsonOk(
      {
        subtask: await createSubtask(
          c.req.param("taskId"),
          input.title,
          user.id,
        ),
      },
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
});

taskRoutes.patch("/subtasks/:subtaskId", async (c) => {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(c.req.raw, subtaskUpdateSchema);
    return jsonOk({
      subtask: await updateSubtask(c.req.param("subtaskId"), input, user.id),
    });
  } catch (error) {
    return handleRouteError(error);
  }
});

taskRoutes.delete("/subtasks/:subtaskId", async (c) => {
  try {
    const user = await requireApiUser();
    await deleteSubtask(c.req.param("subtaskId"), user.id);
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
});

taskRoutes.get("/tasks/:taskId/comments", async (c) => {
  try {
    const user = await requireApiUser();
    return jsonOk({
      comments: await listComments(c.req.param("taskId"), user.id),
    });
  } catch (error) {
    return handleRouteError(error);
  }
});

taskRoutes.post("/tasks/:taskId/comments", async (c) => {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(c.req.raw, commentCreateSchema);
    return jsonOk(
      {
        comment: await createComment(
          c.req.param("taskId"),
          input,
          user.id,
        ),
      },
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
});

taskRoutes.delete("/comments/:commentId", async (c) => {
  try {
    const user = await requireApiUser();
    await deleteComment(c.req.param("commentId"), user.id);
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
});
