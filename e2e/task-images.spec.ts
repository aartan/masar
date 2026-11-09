import { expect, test } from "@playwright/test";

import {
  collectPageErrors,
  columnByName,
  createBoard,
  createTask,
  deleteBoard,
  getBoardDetail,
  uniqueName,
} from "./helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=",
  "base64",
);

test("rejects non-image task attachments with a clear error", async ({
  page,
}) => {
  const boardName = uniqueName("Task Image Rejection");
  const taskTitle = "Attachment rejection";
  let boardId: string | undefined;

  try {
    const board = await createBoard(page.request, boardName);
    boardId = board.id;
    const boardDetail = await getBoardDetail(page.request, boardId);
    const todo = columnByName(boardDetail.columns, "To Do");
    const task = await createTask(page.request, boardId, {
      columnId: todo.id,
      title: taskTitle,
    });

    await page.goto(`/boards/${boardId}`);
    await page
      .getByRole("button", { name: `Open task: ${taskTitle}` })
      .click();

    const sheet = page.getByRole("dialog", { name: "Task details" });
    await sheet.locator('input[type="file"]').setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("this is not an image"),
    });

    await expect(page.getByText("Only image files can be attached")).toBeVisible();
    await expect
      .poll(async () => {
        const response = await page.request.get(`/api/tasks/${task.id}`);
        const body = (await response.json()) as {
          task: { imageCount: number };
        };
        return body.task.imageCount;
      })
      .toBe(0);
  } finally {
    if (boardId) await deleteBoard(page.request, boardId);
  }
});

test("attaches, previews, persists and removes a task image offline", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  const boardName = uniqueName("Task Images");
  const taskTitle = "Attachment task";
  let boardId: string | undefined;

  try {
    const board = await createBoard(page.request, boardName);
    boardId = board.id;
    const boardDetail = await getBoardDetail(page.request, boardId);
    const todo = columnByName(boardDetail.columns, "To Do");
    const task = await createTask(page.request, boardId, {
      columnId: todo.id,
      title: taskTitle,
    });

    await page.goto(`/boards/${boardId}`);
    await page
      .getByRole("button", { name: `Open task: ${taskTitle}` })
      .click();

    const sheet = page.getByRole("dialog", { name: "Task details" });
    await sheet.locator('input[type="file"]').setInputFiles({
      name: "reference.png",
      mimeType: "image/png",
      buffer: PNG,
    });

    const thumbnail = sheet.getByRole("button", {
      name: "Preview reference.png",
    });
    await expect(thumbnail).toBeVisible();
    // No premium storage is configured in E2E, so the renderer embeds the
    // bytes as a data URL rather than pointing at /api/images.
    await expect(thumbnail.locator("img")).toHaveAttribute(
      "src",
      /^data:image\/png;base64,/,
    );

    await expect
      .poll(async () => {
        const response = await page.request.get(`/api/tasks/${task.id}`);
        const body = (await response.json()) as {
          task: { imageCount: number };
        };
        return body.task.imageCount;
      })
      .toBe(1);

    await thumbnail.click();
    const lightbox = page.getByRole("dialog", { name: "reference.png" });
    await expect(lightbox.getByRole("link", { name: "Download" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(lightbox).toBeHidden();

    // The board remembers the open task, so the sheet returns with the page.
    await page.reload({ waitUntil: "networkidle" });
    const reloadedSheet = page.getByRole("dialog", { name: "Task details" });
    await expect(reloadedSheet).toBeVisible();
    const reloadedThumbnail = reloadedSheet.getByRole("button", {
      name: "Preview reference.png",
    });
    await expect(reloadedThumbnail).toBeVisible();

    await reloadedSheet
      .getByRole("button", { name: "Remove reference.png" })
      .click();
    await expect(reloadedThumbnail).toHaveCount(0);
    await expect
      .poll(async () => {
        const response = await page.request.get(`/api/tasks/${task.id}`);
        const body = (await response.json()) as {
          task: { imageCount: number };
        };
        return body.task.imageCount;
      })
      .toBe(0);

    // The free workspace probes premium image storage first; the resulting
    // 409 is the expected fallback signal, not an application error.
    expect(
      errors.filter((message) => !message.includes("409 (Conflict)")),
    ).toEqual([]);
  } finally {
    if (boardId) await deleteBoard(page.request, boardId);
  }
});
