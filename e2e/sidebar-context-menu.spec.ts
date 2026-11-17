import { expect, test } from "@playwright/test";

import {
  collectPageErrors,
  createBoard,
  createFolder,
  createProject,
  deleteProject,
  uniqueName,
} from "./helpers";

test("folder context menu creates a subfolder", async ({ page }) => {
  const errors = collectPageErrors(page);
  const project = await createProject(page.request, uniqueName("Menu project"));
  const folderName = uniqueName("Parent folder");
  const childName = uniqueName("Child folder");

  try {
    await createFolder(page.request, folderName, project.id);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const sidebar = page.locator("aside").first();
    await sidebar
      .getByRole("button", { name: folderName, exact: true })
      .click({ button: "right" });

    await expect(
      page.getByRole("menuitem", { name: "New subfolder" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Move to" }),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: "New subfolder" }).click();

    await expect(
      page.getByRole("heading", { name: "New folder" }),
    ).toBeVisible();
    await page.getByLabel("Folder name").fill(childName);
    await page.getByRole("button", { name: "Create folder" }).click();

    await expect(
      sidebar
        .locator("[data-folder-id]")
        .filter({ hasText: new RegExp(`^${childName}$`) }),
    ).toBeVisible();
  } finally {
    await deleteProject(page.request, project.id);
  }

  expect(errors).toEqual([]);
});

test("space context menu renames a space inline", async ({ page }) => {
  const errors = collectPageErrors(page);
  const project = await createProject(page.request, uniqueName("Rename project"));
  const boardName = uniqueName("Rename space");
  const nextName = uniqueName("Renamed space");
  await createBoard(page.request, boardName, {
    projectId: project.id,
  });

  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const sidebar = page.locator("aside").first();
    await sidebar
      .getByRole("link", { name: boardName, exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename" }).click();

    const input = page.getByRole("textbox", { name: `Rename ${boardName}` });
    await expect(input).toBeVisible();
    await input.fill(nextName);
    await input.press("Enter");

    await expect(sidebar.getByText(nextName, { exact: true })).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: boardName, exact: true }),
    ).toHaveCount(0);

    await page.reload();
    await expect(
      sidebar.getByRole("link", { name: nextName, exact: true }),
    ).toBeVisible();
  } finally {
    await deleteProject(page.request, project.id);
  }

  expect(errors).toEqual([]);
});

test("space context menu moves a space to another project", async ({ page }) => {
  const errors = collectPageErrors(page);
  const source = await createProject(page.request, uniqueName("Move source"));
  const target = await createProject(page.request, uniqueName("Move target"));
  const boardName = uniqueName("Moving space");
  const board = await createBoard(page.request, boardName, {
    projectId: source.id,
  });

  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const sidebar = page.locator("aside").first();
    await sidebar
      .getByRole("link", { name: boardName, exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to" }).click();

    await expect(
      page.getByRole("heading", { name: "Move space" }),
    ).toBeVisible();
    await page.getByRole("combobox", { name: "Project" }).click();
    await page.getByRole("option", { name: target.name, exact: true }).click();
    await page.getByRole("button", { name: "Move space", exact: true }).click();

    await expect(
      sidebar.locator(
        `[data-project-id="${target.id}"] [data-board-id="${board.id}"]`,
      ),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => getComputedStyle(document.body).pointerEvents),
      )
      .not.toBe("none");

    // The app must remain interactive after the menu opened a modal dialog.
    await sidebar
      .locator(
        `[data-project-id="${target.id}"] [data-board-id="${board.id}"] a`,
      )
      .click();
    await expect(page).toHaveURL(new RegExp(`/boards/${board.id}$`));
  } finally {
    await deleteProject(page.request, source.id);
    await deleteProject(page.request, target.id);
  }

  expect(errors).toEqual([]);
});

test("cancelling a context-menu dialog restores sidebar interaction", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  const project = await createProject(page.request, uniqueName("Cancel project"));
  const boardName = uniqueName("Cancel space");
  await createBoard(page.request, boardName, { projectId: project.id });

  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const sidebar = page.locator("aside").first();
    await sidebar
      .getByRole("link", { name: boardName, exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to" }).click();
    await expect(
      page.getByRole("heading", { name: "Move space" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect
      .poll(() =>
        page.evaluate(() => getComputedStyle(document.body).pointerEvents),
      )
      .not.toBe("none");

    await sidebar.getByRole("link", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/\/calendar$/);
  } finally {
    await deleteProject(page.request, project.id);
  }

  expect(errors).toEqual([]);
});

test("deleting the open space from its context menu returns to the overview", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  const project = await createProject(page.request, uniqueName("Delete project"));
  const boardName = uniqueName("Delete space");
  const board = await createBoard(page.request, boardName, {
    projectId: project.id,
  });

  try {
    await page.goto(`/boards/${board.id}`);
    await expect(
      page.getByRole("heading", { name: boardName, level: 1 }),
    ).toBeVisible();

    const sidebar = page.locator("aside").first();
    await sidebar
      .getByRole("link", { name: boardName, exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete space" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete space" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(
      sidebar.locator(`[data-board-id="${board.id}"]`),
    ).toHaveCount(0);
    const detail = await page.request.get(`/api/boards/${board.id}`);
    expect(detail.status()).toBe(404);
  } finally {
    await deleteProject(page.request, project.id);
  }

  expect(errors).toEqual([]);
});

test("space context menu opens from the keyboard with Shift+F10", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  const project = await createProject(page.request, uniqueName("Keyboard project"));
  const boardName = uniqueName("Keyboard space");
  await createBoard(page.request, boardName, { projectId: project.id });

  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const sidebar = page.locator("aside").first();
    const boardLink = sidebar.getByRole("link", {
      name: boardName,
      exact: true,
    });
    await boardLink.focus();
    await page.keyboard.press("Shift+F10");

    await expect(page.getByRole("menu")).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Rename" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
  } finally {
    await deleteProject(page.request, project.id);
  }

  expect(errors).toEqual([]);
});

test("folder context menu renames and moves a folder", async ({ page }) => {
  const errors = collectPageErrors(page);
  const project = await createProject(page.request, uniqueName("Folder project"));
  const folderName = uniqueName("Folder alpha");
  const targetName = uniqueName("Folder beta");
  const nextName = uniqueName("Folder renamed");
  const folder = await createFolder(page.request, folderName, project.id);
  const target = await createFolder(page.request, targetName, project.id);

  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const sidebar = page.locator("aside").first();
    await sidebar
      .getByRole("button", { name: folderName, exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename" }).click();

    const input = page.getByRole("textbox", { name: `Rename ${folderName}` });
    await expect(input).toBeVisible();
    await input.fill(nextName);
    await input.press("Enter");
    await expect(
      sidebar.locator(`[data-folder-id="${folder.id}"]`),
    ).toContainText(nextName);

    await sidebar
      .locator(`[data-folder-id="${folder.id}"]`)
      .getByRole("button", { name: `More actions for ${nextName}` })
      .click();
    await page.getByRole("menuitem", { name: "Move to" }).click();

    await expect(
      page.getByRole("heading", { name: "Move folder" }),
    ).toBeVisible();
    await page.getByRole("combobox", { name: "Location" }).click();
    await page.getByRole("option", { name: targetName, exact: true }).click();
    await page.getByRole("button", { name: "Move folder", exact: true }).click();

    await expect(
      sidebar.locator(
        `[data-folder-id="${target.id}"] [data-folder-id="${folder.id}"]`,
      ),
    ).toBeVisible();
  } finally {
    await deleteProject(page.request, project.id);
  }

  expect(errors).toEqual([]);
});

test("project context menu renames a project inline", async ({ page }) => {
  const errors = collectPageErrors(page);
  const projectName = uniqueName("Project menu");
  const nextName = uniqueName("Project renamed");
  const project = await createProject(page.request, projectName);

  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const sidebar = page.locator("aside").first();
    await sidebar
      .getByRole("button", { name: projectName, exact: true })
      .click({ button: "right" });

    await expect(
      page.getByRole("menuitem", { name: "Open project" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "New folder" }),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: "Rename" }).click();

    const input = page.getByRole("textbox", { name: `Rename ${projectName}` });
    await expect(input).toBeVisible();
    await input.fill(nextName);
    await input.press("Enter");

    await expect(
      sidebar.getByRole("button", { name: nextName, exact: true }),
    ).toBeVisible();
  } finally {
    await deleteProject(page.request, project.id);
  }

  expect(errors).toEqual([]);
});

test("archived project context menu only exposes restore and delete", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  const project = await createProject(page.request, uniqueName("Archived project"));
  await page.request.post(`/api/projects/${project.id}/archive`);

  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const sidebar = page.locator("aside").first();
    await sidebar.getByRole("button", { name: /Archived/ }).click();
    await sidebar
      .getByRole("button", { name: project.name, exact: true })
      .click({ button: "right" });

    await expect(
      page.getByRole("menuitem", { name: "Restore" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Delete project" }),
    ).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Rename" })).toHaveCount(0);
    await expect(
      page.getByRole("menuitem", { name: "New space" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  } finally {
    await deleteProject(page.request, project.id);
  }

  expect(errors).toEqual([]);
});
