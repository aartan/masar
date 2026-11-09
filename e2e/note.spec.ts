import { expect, test } from "@playwright/test";

import {
  collectPageErrors,
  createBoard,
  deleteBoard,
  uniqueName,
} from "./helpers";

test.describe("note workflows", () => {
  test("creates, edits, autosaves, reloads, renames and deletes a note", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const noteName = uniqueName("E2E Note");
    let boardId: string | undefined;

    try {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      // Create a note space through the shared creation dialog. The overview's
      // create button adapts to workspace state; match any of its labels.
      await page
        .getByRole("button", {
          name: /Create your first space|Create another space|New space/,
        })
        .first()
        .click();
      await page.getByRole("radio", { name: /Note/ }).click();
      await page.getByLabel("Space name").fill(noteName);
      await page.getByRole("button", { name: /Create space/ }).click();
      await expect(page).toHaveURL(/\/boards\/[0-9a-f-]+$/);
      boardId = page.url().split("/boards/")[1];

      // The title is displayed in the header bar above the editor; the note
      // itself starts blank.
      await expect(
        page.getByRole("heading", { level: 1, name: noteName }),
      ).toBeVisible();

      // Type into the BlockNote editor and let the debounced autosave land.
      const editor = page.locator(".masar-note .bn-editor");
      await editor.click();
      await page.keyboard.type("Hello from the note");
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();

      // The formatting toolbar is pinned above the editor rather than floating
      // over the selection, so it stays available while writing.
      const toolbar = page.locator(".masar-note-toolbar .bn-formatting-toolbar");
      await expect(toolbar).toBeVisible();
      await expect(
        toolbar.getByRole("button", { name: "Bold", exact: true }),
      ).toBeVisible();

      // Content persists across a reload.
      await page.reload({ waitUntil: "networkidle" });
      await expect(page.locator(".masar-note .bn-editor")).toContainText(
        "Hello from the note",
      );

      // Rename through the settings dialog.
      const renamed = `${noteName} renamed`;
      await page.getByRole("button", { name: "Note settings" }).click();
      const settings = page.getByRole("dialog", { name: "Space settings" });
      await settings.getByRole("textbox", { name: "Name" }).fill(renamed);
      await settings.getByRole("button", { name: "Save changes" }).click();
      await expect(
        page.getByRole("heading", { level: 1, name: renamed }),
      ).toBeVisible();

      // Delete through the settings dialog, with confirmation.
      await page.getByRole("button", { name: "Note settings" }).click();
      await page.getByRole("button", { name: "Delete space…" }).click();
      const confirm = page.getByRole("alertdialog");
      await expect(confirm.getByText(`Delete ${renamed}?`)).toBeVisible();
      await confirm.getByRole("button", { name: "Delete note" }).click();
      await expect(page).toHaveURL("/");
      await expect(
        page.getByRole("heading", { level: 1, name: renamed }),
      ).toHaveCount(0);

      boardId = undefined;
      expect(errors).toEqual([]);
    } finally {
      if (boardId) await deleteBoard(page.request, boardId);
    }
  });

  test("keeps note content when opening it through the project and the sidebar", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const noteName = uniqueName("E2E Sidebar Note");
    let boardId: string | undefined;

    try {
      const board = await createBoard(page.request, noteName, {
        type: "note",
      });
      boardId = board.id;

      await page.goto("/");
      const sidebarLink = page
        .getByRole("link", { name: new RegExp(noteName) })
        .first();
      await sidebarLink.click();
      await expect(page).toHaveURL(new RegExp(`/boards/${board.id}$`));

      // The note renders its editor (an empty document shows the placeholder).
      await expect(page.locator(".masar-note .bn-editor")).toBeVisible();
      await page.locator(".masar-note .bn-editor").click();
      await page.keyboard.type("Sidebar navigation works");
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();

      expect(errors).toEqual([]);
    } finally {
      if (boardId) await deleteBoard(page.request, boardId);
    }
  });
});
