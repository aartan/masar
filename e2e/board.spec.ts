import { expect, test } from "@playwright/test";

import {
  collectPageErrors,
  columnByName,
  createBoard,
  createTask,
  deleteBoard,
  getBoardDetail,
  signUp,
  uniqueName,
} from "./helpers";

test.describe("board workflows", () => {
  test.beforeEach(async ({ page }) => {
    await signUp(page.request);
    await page.goto("/");
  });

  test("creates a board, edits a task, filters, switches views, and searches", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const boardName = uniqueName("E2E Board");
    const taskTitle = "E2E task";
    const updatedTitle = "E2E task updated";
    let boardId: string | undefined;

    try {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      await page.getByRole("button", { name: "New board", exact: true }).first().click();
      await page.getByLabel("Name").fill(boardName);
      await page.getByRole("button", { name: /Create board/ }).click();
      await expect(page).toHaveURL(/\/boards\/[0-9a-f-]+$/);
      boardId = page.url().split("/boards/")[1];
      await expect(page.getByRole("heading", { name: boardName })).toBeVisible();

      const todo = page.getByRole("region", { name: "To Do column" });
      await expect(todo).toBeVisible();
      await todo.getByRole("button", { name: "Add task", exact: true }).click();
      await todo.getByPlaceholder("Write a task and press Enter…").fill(taskTitle);
      await todo.getByPlaceholder("Write a task and press Enter…").press("Enter");

      const card = page.getByRole("button", { name: `Open task: ${taskTitle}` });
      await expect(card).toBeVisible();
      await card.click();

      const sheet = page.getByRole("dialog", { name: "Task details" });
      await expect(sheet).toBeVisible();
      const titleBox = sheet.getByRole("textbox", { name: "Task title" });
      await expect(titleBox).toHaveValue(taskTitle);

      // Priority
      await sheet
        .getByRole("combobox")
        .filter({ hasText: "No priority" })
        .click();
      await page.getByRole("option", { name: "High" }).click();
      await expect(
        sheet.getByRole("combobox").filter({ hasText: "High" }),
      ).toBeVisible();

      // Label
      await sheet.getByRole("button", { name: "Manage" }).click();
      await page.getByPlaceholder("New label").fill("Design");
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(sheet.getByText("Design", { exact: true })).toBeVisible();

      // Subtask
      await sheet.getByPlaceholder("Add a subtask…").fill("Draft copy");
      await sheet.getByRole("button", { name: "Add subtask" }).click();
      const subtaskCheckbox = sheet.getByRole("checkbox", {
        name: "Subtask: Draft copy",
      });
      await expect(subtaskCheckbox).toBeVisible();
      const subtaskPatch = page.waitForResponse(
        (response) =>
          /\/api\/subtasks\/[^/]+$/.test(new URL(response.url()).pathname) &&
          response.request().method() === "PATCH",
      );
      await subtaskCheckbox.click();
      await subtaskPatch;
      await expect(subtaskCheckbox).toBeChecked();
      await expect(sheet.getByText("1/1", { exact: true })).toBeVisible();

      // Comment
      const commentBox = sheet.getByPlaceholder("Leave a comment…");
      await commentBox.fill("Ready for review.");
      await sheet.getByRole("button", { name: "Comment", exact: true }).click();
      await expect(commentBox).toHaveValue("");
      await expect(sheet.getByText("Ready for review.", { exact: true })).toBeVisible();

      // Title edit persists on blur/Enter.
      const patch = page.waitForResponse(
        (response) =>
          /\/api\/tasks\/[^/]+$/.test(new URL(response.url()).pathname) &&
          response.request().method() === "PATCH",
      );
      await titleBox.fill(updatedTitle);
      await titleBox.press("Enter");
      const patchResponse = await patch;
      expect(patchResponse.ok()).toBe(true);
      const patched = (await patchResponse.json()) as { task: { title: string } };
      expect(patched.task.title).toBe(updatedTitle);
      await sheet.getByRole("button", { name: "Close task details" }).click();

      await expect(
        page.getByRole("button", { name: `Open task: ${updatedTitle}` }),
      ).toBeVisible();

      // Everything survives a reload.
      await page.reload({ waitUntil: "networkidle" });
      await page
        .getByRole("button", { name: `Open task: ${updatedTitle}` })
        .click();
      const reopened = page.getByRole("dialog", { name: "Task details" });
      await expect(reopened.getByText("Draft copy", { exact: true })).toBeVisible();
      await expect(
        reopened.getByRole("checkbox", { name: "Subtask: Draft copy" }),
      ).toBeChecked();
      await expect(reopened.getByText("Ready for review.", { exact: true })).toBeVisible();
      await expect(
        reopened.getByRole("combobox").filter({ hasText: "High" }),
      ).toBeVisible();
      await expect(reopened.getByText("Design", { exact: true })).toBeVisible();
      await reopened.getByRole("button", { name: "Close task details" }).click();

      // Filter by priority.
      await page.getByRole("button", { name: "Priority", exact: true }).click();
      await page.getByRole("menuitemcheckbox", { name: /High/ }).click();
      await page.keyboard.press("Escape");
      await expect(page.getByText("1 of 1", { exact: true })).toBeVisible();
      await page
        .getByRole("toolbar", { name: "Board filters" })
        .getByRole("button", { name: /^Clear/ })
        .click();

      // List view opens the same task.
      await page.getByRole("button", { name: "List", exact: true }).click();
      await page
        .getByRole("button", { name: `Open task: ${updatedTitle}` })
        .click();
      await expect(page.getByRole("dialog", { name: "Task details" })).toBeVisible();
      await page.getByRole("button", { name: "Close task details" }).click();
      await page.getByRole("button", { name: "Board", exact: true }).click();

      // Command palette deep-links into the task.
      await page.keyboard.press("Control+k");
      const search = page.getByRole("textbox", { name: "Search tasks and boards" });
      await expect(search).toBeVisible();
      await search.fill("E2E task updated");
      const option = page.getByRole("option", { name: /E2E task updated/ });
      await expect(option).toBeVisible();
      await option.click();
      await expect(page).toHaveURL(/\?task=/);
      await expect(page.getByRole("dialog", { name: "Task details" })).toBeVisible();
      await page.getByRole("button", { name: "Close task details" }).click();

      expect(errors).toEqual([]);
    } finally {
      if (boardId) await deleteBoard(page.request, boardId);
    }
  });

  test("persists a drag-and-drop move across columns", async ({ page }) => {
    const errors = collectPageErrors(page);
    const boardName = uniqueName("E2E Drag");
    const taskTitle = "Drag me";
    let boardId: string | undefined;

    try {
      const board = await createBoard(page.request, boardName);
      boardId = board.id;
      const detail = await getBoardDetail(page.request, boardId);
      const todo = columnByName(detail.columns, "To Do");
      await createTask(page.request, boardId, {
        columnId: todo.id,
        title: taskTitle,
      });

      await page.goto(`/boards/${boardId}`);
      const card = page.getByRole("button", { name: `Open task: ${taskTitle}` });
      await expect(card).toBeVisible();

      const cardBox = await card.boundingBox();
      const inProgress = page.getByRole("region", { name: "In Progress column" });
      const targetBox = await inProgress.boundingBox();
      expect(cardBox).not.toBeNull();
      expect(targetBox).not.toBeNull();

      if (!cardBox || !targetBox) throw new Error("Missing drag geometry");
      await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 36);
      await page.mouse.down();
      await page.mouse.move(cardBox.x + cardBox.width / 2 + 10, cardBox.y + 46, {
        steps: 4,
      });
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 260, {
        steps: 24,
      });
      await page.mouse.up();

      await expect(
        inProgress.getByRole("button", { name: `Open task: ${taskTitle}` }),
      ).toBeVisible();
      await expect(page.getByText("Moved to In Progress")).toBeVisible();

      await page.reload({ waitUntil: "networkidle" });
      await expect(
        page
          .getByRole("region", { name: "In Progress column" })
          .getByRole("button", { name: `Open task: ${taskTitle}` }),
      ).toBeVisible();

      expect(errors).toEqual([]);
    } finally {
      if (boardId) await deleteBoard(page.request, boardId);
    }
  });

  test("reorders a task within the same column", async ({ page }) => {
    const errors = collectPageErrors(page);
    const boardName = uniqueName("E2E Reorder");
    let boardId: string | undefined;

    try {
      const board = await createBoard(page.request, boardName);
      boardId = board.id;
      const detail = await getBoardDetail(page.request, boardId);
      const todo = columnByName(detail.columns, "To Do");
      const first = await createTask(page.request, boardId, {
        columnId: todo.id,
        title: "First task",
      });
      const second = await createTask(page.request, boardId, {
        columnId: todo.id,
        title: "Second task",
      });
      const third = await createTask(page.request, boardId, {
        columnId: todo.id,
        title: "Third task",
      });

      await page.goto(`/boards/${boardId}`);
      const todoRegion = page.getByRole("region", { name: "To Do column" });
      const cardOrder = () =>
        todoRegion
          .locator("[data-task-id]")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("data-task-id")),
          );

      await expect(todoRegion.locator("[data-task-id]")).toHaveCount(3);
      expect(await cardOrder()).toEqual([first.id, second.id, third.id]);

      const firstBox = await page
        .getByRole("button", { name: "Open task: First task" })
        .boundingBox();
      const secondBox = await page
        .getByRole("button", { name: "Open task: Second task" })
        .boundingBox();
      if (!firstBox || !secondBox) throw new Error("Missing drag geometry");

      const saved = page.waitForResponse(
        (response) =>
          response.url().includes("/tasks/reorder") &&
          response.request().method() === "POST",
      );
      await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + 24);
      await page.mouse.down();
      await page.mouse.move(
        firstBox.x + firstBox.width / 2 + 10,
        firstBox.y + 34,
        { steps: 4 },
      );
      await page.mouse.move(
        secondBox.x + secondBox.width / 2,
        secondBox.y + secondBox.height / 2,
        { steps: 20 },
      );
      await page.mouse.up();
      await saved;

      await expect.poll(cardOrder).toEqual([second.id, first.id, third.id]);

      await page.reload({ waitUntil: "networkidle" });
      const reloadedOrder = await page
        .getByRole("region", { name: "To Do column" })
        .locator("[data-task-id]")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-task-id")),
        );
      expect(reloadedOrder).toEqual([second.id, first.id, third.id]);

      expect(errors).toEqual([]);
    } finally {
      if (boardId) await deleteBoard(page.request, boardId);
    }
  });

  test("confirms destructive actions before deleting tasks and boards", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const boardName = uniqueName("E2E Delete");
    const taskTitle = "Delete me";
    let boardId: string | undefined;

    try {
      const board = await createBoard(page.request, boardName);
      boardId = board.id;
      const detail = await getBoardDetail(page.request, boardId);
      const todo = columnByName(detail.columns, "To Do");
      await createTask(page.request, boardId, { columnId: todo.id, title: taskTitle });

      await page.goto(`/boards/${boardId}`);
      await page.getByRole("button", { name: `Task actions for ${taskTitle}` }).click();
      await page.getByRole("menuitem", { name: "Delete task" }).click();
      const taskDialog = page.getByRole("alertdialog");
      await expect(taskDialog.getByText("Delete this task?")).toBeVisible();
      await taskDialog.getByRole("button", { name: "Delete task" }).click();
      await expect(
        page.getByRole("button", { name: `Open task: ${taskTitle}` }),
      ).toHaveCount(0);

      await page.getByRole("button", { name: "Board actions" }).click();
      await page.getByRole("menuitem", { name: "Delete board" }).click();
      const boardDialog = page.getByRole("alertdialog");
      await expect(
        boardDialog.getByText(`Delete ${boardName}?`),
      ).toBeVisible();
      await boardDialog.getByRole("button", { name: "Delete board" }).click();
      await expect(page).toHaveURL("/");
      await expect(page.getByRole("link", { name: boardName })).toHaveCount(0);

      boardId = undefined;
      expect(errors).toEqual([]);
    } finally {
      if (boardId) await deleteBoard(page.request, boardId);
    }
  });

  test("dashboard reflects live workspace data", async ({ page }) => {
    const errors = collectPageErrors(page);
    const boardName = uniqueName("E2E Stats");
    let boardId: string | undefined;

    try {
      const board = await createBoard(page.request, boardName);
      boardId = board.id;
      const detail = await getBoardDetail(page.request, boardId);
      const todo = columnByName(detail.columns, "To Do");
      const done = columnByName(detail.columns, "Done");
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      await createTask(page.request, boardId, {
        columnId: todo.id,
        title: "E2E due soon",
        priority: "high",
        dueDate: tomorrow,
      });
      await createTask(page.request, boardId, {
        columnId: done.id,
        title: "E2E completed",
      });

      await page.goto("/");
      const main = page.getByRole("main");
      await expect(main.getByText("Active boards")).toBeVisible();
      await expect(main.getByText(boardName, { exact: true }).first()).toBeVisible();
      await expect(main.getByText("1/2", { exact: true })).toBeVisible();
      await expect(main.getByText("E2E due soon").first()).toBeVisible();
      await expect(main.getByText("E2E completed").first()).toBeVisible();
      await expect(main.getByText("50%", { exact: true })).toBeVisible();

      expect(errors).toEqual([]);
    } finally {
      if (boardId) await deleteBoard(page.request, boardId);
    }
  });

  test("mobile navigation and dark theme work at a phone viewport", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const boardName = uniqueName("E2E Mobile");
    let boardId: string | undefined;

    try {
      const board = await createBoard(page.request, boardName);
      boardId = board.id;

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/boards/${boardId}`);
      await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Backlog column" })).toBeVisible();

      await page.getByRole("button", { name: "Open navigation" }).click();
      const nav = page.getByRole("dialog", { name: "Navigation" });
      await expect(nav).toBeVisible();
      await expect(nav.getByRole("link", { name: boardName })).toBeVisible();

      await nav.getByRole("button", { name: "Change theme" }).click();
      await page.getByRole("menuitemradio", { name: "Dark" }).click();
      await expect(page.locator("html")).toHaveClass(/dark/);
      await page.getByRole("button", { name: "Close navigation" }).click();
      await expect(nav).toHaveCount(0);

      expect(errors).toEqual([]);
    } finally {
      if (boardId) await deleteBoard(page.request, boardId);
    }
  });
});
