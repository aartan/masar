import { Hono } from "hono";

import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { requireApiUser } from "@/lib/server/auth";
import {
  createBoard,
  deleteBoard,
  getBoardDetail,
  listBoards,
  reorderBoards,
  updateBoard,
} from "@/lib/server/boards";
import { createColumn, deleteColumn, reorderColumns, updateColumn } from "@/lib/server/columns";
import { createLabel, deleteLabel, updateLabel } from "@/lib/server/labels";
import { createTask, reorderTasks } from "@/lib/server/tasks";
import {
  boardCreateSchema,
  boardUpdateSchema,
  columnCreateSchema,
  columnUpdateSchema,
  labelCreateSchema,
  labelUpdateSchema,
  reorderBoardsSchema,
  reorderColumnsSchema,
  reorderTasksSchema,
  taskCreateSchema,
} from "@/lib/validation";

export const boardRoutes = new Hono();

boardRoutes.get("/boards", async (_c) => {
  try {
    const user = await requireApiUser();
    return jsonOk({ boards: await listBoards(user.id) });
  } catch (error) {
    return handleRouteError(error);
  }
});

boardRoutes.post("/boards", async (c) => {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(c.req.raw, boardCreateSchema);
    return jsonOk({ board: await createBoard(input, user.id) }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
});

boardRoutes.post("/boards/reorder", async (c) => {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(c.req.raw, reorderBoardsSchema);
    return jsonOk({ boards: await reorderBoards(input.boardIds, user.id) });
  } catch (error) {
    return handleRouteError(error);
  }
});

boardRoutes.get("/boards/:boardId", async (c) => {
  try {
    const user = await requireApiUser();
    return jsonOk({ board: await getBoardDetail(c.req.param("boardId"), user.id) });
  } catch (error) {
    return handleRouteError(error);
  }
});

boardRoutes.patch("/boards/:boardId", async (c) => {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(c.req.raw, boardUpdateSchema);
    return jsonOk({
      board: await updateBoard(c.req.param("boardId"), input, user.id),
    });
  } catch (error) {
    return handleRouteError(error);
  }
});

boardRoutes.delete("/boards/:boardId", async (c) => {
  try {
    const user = await requireApiUser();
    await deleteBoard(c.req.param("boardId"), user.id);
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
});

boardRoutes.post("/boards/:boardId/columns", async (c) => {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(c.req.raw, columnCreateSchema);
    return jsonOk(
      { column: await createColumn(c.req.param("boardId"), input, user.id) },
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
});

boardRoutes.post("/boards/:boardId/columns/reorder", async (c) => {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(c.req.raw, reorderColumnsSchema);
    return jsonOk({
      columns: await reorderColumns(c.req.param("boardId"), input.columnIds, user.id),
    });
  } catch (error) {
    return handleRouteError(error);
  }
});

boardRoutes.post("/boards/:boardId/labels", async (c) => {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(c.req.raw, labelCreateSchema);
    return jsonOk(
      { label: await createLabel(c.req.param("boardId"), input, user.id) },
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
});

boardRoutes.post("/boards/:boardId/tasks", async (c) => {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(c.req.raw, taskCreateSchema);
    return jsonOk(
      { task: await createTask(c.req.param("boardId"), input, user.id) },
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
});

boardRoutes.post("/boards/:boardId/tasks/reorder", async (c) => {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(c.req.raw, reorderTasksSchema);
    return jsonOk({
      tasks: await reorderTasks(c.req.param("boardId"), input, user.id),
    });
  } catch (error) {
    return handleRouteError(error);
  }
});

boardRoutes.patch("/columns/:columnId", async (c) => {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(c.req.raw, columnUpdateSchema);
    return jsonOk({
      column: await updateColumn(c.req.param("columnId"), input, user.id),
    });
  } catch (error) {
    return handleRouteError(error);
  }
});

boardRoutes.delete("/columns/:columnId", async (c) => {
  try {
    const user = await requireApiUser();
    return jsonOk(await deleteColumn(c.req.param("columnId"), user.id));
  } catch (error) {
    return handleRouteError(error);
  }
});

boardRoutes.patch("/labels/:labelId", async (c) => {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(c.req.raw, labelUpdateSchema);
    return jsonOk({
      label: await updateLabel(c.req.param("labelId"), input, user.id),
    });
  } catch (error) {
    return handleRouteError(error);
  }
});

boardRoutes.delete("/labels/:labelId", async (c) => {
  try {
    const user = await requireApiUser();
    await deleteLabel(c.req.param("labelId"), user.id);
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
});
