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
    const noteDescription = uniqueName("E2E Note description");
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
      await page.getByLabel(/Description/).fill(noteDescription);
      await page.getByRole("button", { name: /Create space/ }).click();
      await expect(page).toHaveURL(/\/boards\/[0-9a-f-]+$/);
      boardId = page.url().split("/boards/")[1];

      // The space title is in the header; the note starts with an H1 block.
      await expect(
        page.getByRole("heading", { level: 1, name: noteName }),
      ).toBeVisible();
      const editor = page.locator(".masar-note .bn-editor");
      await expect(
        editor.locator('[data-content-type="heading"]').first(),
      ).toBeVisible();
      await expect(
        page.getByText(noteDescription, { exact: true }),
      ).toBeVisible();

      const emptyDocumentPlaceholder = editor.locator(".bn-block-content").first();
      await expect
        .poll(() =>
          emptyDocumentPlaceholder.evaluate((element) =>
            getComputedStyle(element, "::after").content,
          ),
        )
        .toContain("Start writing");

      // Type into the BlockNote editor and let the debounced autosave land.
      await editor.click();
      await page.keyboard.type("Hello from the note");
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      await page.keyboard.press("Enter");
      const nextLinePlaceholder = editor.locator(".bn-block-content").last();
      await expect
        .poll(() =>
          nextLinePlaceholder.evaluate((element) =>
            getComputedStyle(element, "::after").content,
          ),
        )
        .not.toContain("Start writing");
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      await expect(page.locator(".masar-note .bn-side-menu")).toHaveCount(0);
      const noteContent = page.locator(".masar-note-content");
      await expect(noteContent).toHaveCSS("max-width", "none");

      // Formatting controls stay in a full-width row above the editor.
      const toolbar = page.locator(".masar-note-toolbar-scroll");
      await expect(toolbar).toBeVisible();
      for (const label of [
        "Paragraph",
        "Heading 1",
        "Heading 2",
        "Heading 3",
        "Bold",
        "Italic",
        "Underline",
        "Strikethrough",
        "Align left",
        "Align center",
        "Align right",
        "Bulleted list",
        "Numbered list",
        "Insert link",
        "Insert image",
        "Code block",
        "Narrow note width",
        "Standard note width",
        "Wide note width",
      ]) {
        await expect(
          toolbar.getByRole("button", { name: label, exact: true }),
        ).toBeVisible();
      }

      const wideWidthButton = toolbar.getByRole("button", {
        name: "Wide note width",
      });
      await expect(wideWidthButton).toHaveText("");
      await expect(wideWidthButton.locator("svg")).toBeVisible();

      await toolbar.getByRole("button", { name: "Standard note width" }).click();
      await expect(noteContent).toHaveCSS("max-width", "960px");

      // Content persists across a reload.
      await page.reload({ waitUntil: "networkidle" });
      await expect(page.locator(".masar-note .bn-editor")).toContainText(
        "Hello from the note",
      );
      await expect(page.locator(".masar-note-content")).toHaveCSS(
        "max-width",
        "960px",
      );
      await expect(
        page.getByText(noteDescription, { exact: true }),
      ).toBeVisible();

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

  test("does not open a slash menu in the note editor", async ({ page }) => {
    const noteName = uniqueName("E2E Note Slash");
    let boardId: string | undefined;

    try {
      const board = await createBoard(page.request, noteName, {
        type: "note",
      });
      boardId = board.id;

      await page.goto(`/boards/${boardId}`);
      const editor = page.locator(".masar-note .bn-editor");
      await expect(editor).toBeVisible();
      await editor.click();
      await page.keyboard.type("/");

      await expect(editor).toContainText("/");
      await expect(page.locator(".bn-suggestion-menu")).toHaveCount(0);
    } finally {
      if (boardId) await deleteBoard(page.request, boardId);
    }
  });
});
