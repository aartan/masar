import { expect, test } from "@playwright/test";

import {
  collectPageErrors,
  createBoard,
  createProject,
  deleteProject,
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
    void kanban;

    expect(errors).toEqual([]);
  } finally {
    await deleteProject(page.request, project.id);
  }
});
