import { expect, test } from "@playwright/test";

import {
  collectPageErrors,
  createBoard,
  deleteBoard,
  uniqueName,
} from "./helpers";

test("reorders sidebar boards by dragging and persists the order", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  const names = [
    uniqueName("Sidebar A"),
    uniqueName("Sidebar B"),
    uniqueName("Sidebar C"),
  ];
  const boardIds: string[] = [];

  try {
    for (const name of names) {
      const board = await createBoard(page.request, name);
      boardIds.push(board.id);
    }

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const sidebar = page.locator("aside").first();
    const renderedBoardIds = () =>
      sidebar
        .locator("[data-board-id]")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-board-id")),
        );
    await expect.poll(renderedBoardIds).toEqual(boardIds);
    await expect(
      sidebar.getByRole("link", { name: new RegExp(names[0]) }),
    ).toHaveCSS("font-size", "13px");

    const firstHandle = sidebar.getByRole("button", {
      name: `Reorder board ${names[0]}`,
    });
    const thirdHandle = sidebar.getByRole("button", {
      name: `Reorder board ${names[2]}`,
    });
    const reorderResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/boards/reorder") &&
        response.request().method() === "POST",
    );
    await firstHandle.dragTo(thirdHandle);
    const response = await reorderResponse;
    expect(response.ok()).toBe(true);

    const expectedOrder = [boardIds[1], boardIds[2], boardIds[0]];
    await expect.poll(renderedBoardIds).toEqual(expectedOrder);

    await page.reload({ waitUntil: "networkidle" });
    await expect.poll(renderedBoardIds).toEqual(expectedOrder);

    await sidebar
      .getByRole("link", { name: new RegExp(names[1]) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/boards/${boardIds[1]}$`));

    expect(errors).toEqual([]);
  } finally {
    for (const boardId of boardIds) {
      await deleteBoard(page.request, boardId);
    }
  }
});
