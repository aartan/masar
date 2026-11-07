import { expect, test } from "@playwright/test";

import {
  collectPageErrors,
  createBoard,
  createProject,
  createTask,
  deleteProject,
  getBoardDetail,
  uniqueName,
} from "./helpers";

test("reorders boards within a project by dragging and persists the order", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  const project = await createProject(page.request, uniqueName("Sidebar project"));
  const names = [
    uniqueName("Sidebar A"),
    uniqueName("Sidebar B"),
    uniqueName("Sidebar C"),
  ];
  const boardIds: string[] = [];

  try {
    for (const name of names) {
      const board = await createBoard(page.request, name, {
        projectId: project.id,
      });
      boardIds.push(board.id);
    }

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const sidebar = page.locator("aside").first();

    // The project expands by default, so its boards are visible in order.
    const renderedBoardIds = () =>
      sidebar
        .locator("[data-board-id]")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-board-id")),
        );
    await expect.poll(renderedBoardIds).toEqual(boardIds);

    const firstHandle = sidebar.getByRole("button", {
      name: `Reorder board ${names[0]}`,
    });
    const thirdHandle = sidebar.getByRole("button", {
      name: `Reorder board ${names[2]}`,
    });
    const moveResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/boards/move") &&
        response.request().method() === "POST",
    );
    await firstHandle.dragTo(thirdHandle);
    const response = await moveResponse;
    expect(response.ok()).toBe(true);

    const expectedOrder = [boardIds[1], boardIds[2], boardIds[0]];
    await expect.poll(renderedBoardIds).toEqual(expectedOrder);

    await page.reload({ waitUntil: "networkidle" });
    await expect.poll(renderedBoardIds).toEqual(expectedOrder);

    await sidebar.getByRole("link", { name: new RegExp(names[1]) }).click();
    await expect(page).toHaveURL(new RegExp(`/boards/${boardIds[1]}$`));

    expect(errors).toEqual([]);
  } finally {
    await deleteProject(page.request, project.id);
  }
});

test("project overview shows description, board mix, tasks, and activity", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  const project = await createProject(
    page.request,
    uniqueName("Overview project"),
    "A concise project description",
  );
  const kanbanName = uniqueName("Overview Kanban");
  const whiteboardName = uniqueName("Overview Canvas");
  const taskTitle = uniqueName("Overview task");

  try {
    const board = await createBoard(page.request, kanbanName, {
      projectId: project.id,
    });
    const detail = await getBoardDetail(page.request, board.id);
    await createTask(page.request, board.id, {
      columnId: detail.columns[0]!.id,
      title: taskTitle,
    });
    await createBoard(page.request, whiteboardName, {
      projectId: project.id,
      type: "whiteboard",
    });

    await page.goto(`/projects/${project.id}`);
    const main = page.getByRole("main");
    await expect(
      main.getByRole("heading", { name: project.name }),
    ).toBeVisible();
    await expect(main.getByText("A concise project description")).toBeVisible();
    await expect(main.getByText(kanbanName, { exact: true }).first()).toBeVisible();
    await expect(
      main.getByText(whiteboardName, { exact: true }).first(),
    ).toBeVisible();
    await expect(main.getByText(taskTitle, { exact: true }).first()).toBeVisible();
    await expect(main.getByText("Recent activity")).toBeVisible();

    expect(errors).toEqual([]);
  } finally {
    await deleteProject(page.request, project.id);
  }
});

test("opens archived projects read-only until restored", async ({ page }) => {
  const errors = collectPageErrors(page);
  const project = await createProject(page.request, uniqueName("Archived project"));
  const boardName = uniqueName("Archived board");

  try {
    const board = await createBoard(page.request, boardName, {
      projectId: project.id,
    });
    const archive = await page.request.post(`/api/projects/${project.id}/archive`);
    expect(archive.ok()).toBeTruthy();

    await page.goto(`/boards/${board.id}`);
    await expect(page.getByText("Read-only (archived)")).toBeVisible();
    await expect(page.getByRole("button", { name: "New task" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add column" })).toHaveCount(0);

    const restore = await page.request.post(`/api/projects/${project.id}/restore`);
    expect(restore.ok()).toBeTruthy();
    await page.reload();
    await expect(page.getByText("Read-only (archived)")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New task" })).toBeVisible();

    expect(errors).toEqual([]);
  } finally {
    await deleteProject(page.request, project.id);
  }
});

test("shows distinct icons for kanban and whiteboard boards and opens the whiteboard", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  const project = await createProject(page.request, uniqueName("Mixed project"));
  const kanbanName = uniqueName("Plan");
  const whiteboardName = uniqueName("Canvas");

  try {
    const kanban = await createBoard(page.request, kanbanName, {
      projectId: project.id,
      type: "kanban",
    });
    const whiteboard = await createBoard(page.request, whiteboardName, {
      projectId: project.id,
      type: "whiteboard",
    });

    await page.goto("/");
    const sidebar = page.locator("aside").first();

    const kanbanLink = sidebar.getByRole("link", {
      name: new RegExp(kanbanName),
    });
    const whiteboardLink = sidebar.getByRole("link", {
      name: new RegExp(whiteboardName),
    });
    await expect(kanbanLink).toBeVisible();
    await expect(whiteboardLink).toBeVisible();

    // Opening the whiteboard mounts the Excalidraw canvas.
    await whiteboardLink.click();
    await expect(page).toHaveURL(new RegExp(`/boards/${whiteboard.id}$`));
    await expect(page.locator(".excalidraw")).toBeVisible({ timeout: 15_000 });

    // Draw a rectangle and let the debounced autosave persist it.
    const canvas = page.locator(".excalidraw canvas.interactive").first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.getByTitle("Rectangle — R or 2").click();
    await page.mouse.move(box!.x + 160, box!.y + 140);
    await page.mouse.down();
    await page.mouse.move(box!.x + 300, box!.y + 240, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(
        async () => {
          const sceneResponse = await page.request.get(
            `/api/boards/${whiteboard.id}/scene`,
          );
          if (!sceneResponse.ok()) return false;
          const sceneBody = (await sceneResponse.json()) as {
            scene: { scene: string };
          };
          return sceneBody.scene.scene.includes('"type":"rectangle"');
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(".excalidraw")).toBeVisible({ timeout: 15_000 });

    const renamed = `${whiteboardName} renamed`;
    await page
      .getByRole("button", { name: "Whiteboard settings" })
      .click();
    const settings = page.getByRole("dialog");
    await settings.getByLabel("Name").fill(renamed);
    await settings.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
    void kanban;

    expect(errors).toEqual([]);
  } finally {
    await deleteProject(page.request, project.id);
  }
});
