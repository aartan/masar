import { expect, test } from "@playwright/test";

import {
  collectPageErrors,
  createBoard,
  createTask,
  deleteBoard,
  getBoardDetail,
  uniqueName,
} from "./helpers";

test("saves task descriptions on blur and on panel dismissal", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  const boardName = uniqueName("Description Autosave");
  const taskTitle = "Description autosave task";
  let boardId: string | undefined;

  try {
    const board = await createBoard(page.request, boardName);
    boardId = board.id;
    const boardDetail = await getBoardDetail(page.request, boardId);
    const todo = boardDetail.columns.find((column) => column.name === "To Do");
    if (!todo) throw new Error("To Do column not found");
    const task = await createTask(page.request, boardId, {
      columnId: todo.id,
      title: taskTitle,
    });

    await page.goto(`/boards/${boardId}`);
    await page
      .getByRole("button", { name: `Open task: ${taskTitle}` })
      .click();

    const sheet = page.getByRole("dialog", { name: "Task details" });
    const description = sheet.getByPlaceholder(
      "Add context, links, or acceptance criteria…",
    );
    const taskPatch = () =>
      page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/tasks/${task.id}`) &&
          response.request().method() === "PATCH",
      );

    await description.fill("Saved after clicking inside the panel");
    const insidePatch = taskPatch();
    await sheet.getByRole("heading", { name: "Description" }).click();
    const insideResponse = await insidePatch;
    expect(insideResponse.ok()).toBe(true);
    expect(
      ((await insideResponse.json()) as { task: { description: string } }).task
        .description,
    ).toBe("Saved after clicking inside the panel");

    await description.fill("Saved when the panel is dismissed");
    const outsidePatch = taskPatch();
    await page.mouse.click(20, 20);
    const outsideResponse = await outsidePatch;
    expect(outsideResponse.ok()).toBe(true);
    expect(
      ((await outsideResponse.json()) as { task: { description: string } }).task
        .description,
    ).toBe("Saved when the panel is dismissed");
    await expect(sheet).toBeHidden();

    await page.reload({ waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: `Open task: ${taskTitle}` })
      .click();
    await expect(
      page
        .getByRole("dialog", { name: "Task details" })
        .getByPlaceholder("Add context, links, or acceptance criteria…"),
    ).toHaveValue("Saved when the panel is dismissed");

    expect(errors).toEqual([]);
  } finally {
    if (boardId) await deleteBoard(page.request, boardId);
  }
});
