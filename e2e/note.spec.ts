import { expect, test } from "@playwright/test";

import {
  collectPageErrors,
  createBoard,
  deleteBoard,
  uniqueName,
} from "./helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=",
  "base64",
);

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

      // A brand-new note invites its title, like Apple Notes — and stays
      // visible even though the editor opens focused.
      const emptyDocumentPlaceholder = editor.locator(".bn-block-content").first();
      await expect
        .poll(() =>
          emptyDocumentPlaceholder.evaluate((element) =>
            getComputedStyle(element, "::after").content,
          ),
        )
        .toContain("Title");

      // The note opens ready to type: the editor holds focus, so typing
      // lands without a click.
      await expect
        .poll(() =>
          editor.evaluate((element) => {
            const active = document.activeElement;
            return Boolean(active && element.contains(active));
          }),
        )
        .toBe(true);
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
        .not.toContain("Title");
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      await expect(page.locator(".masar-note .bn-side-menu")).toHaveCount(0);
      const noteContent = page.locator(".masar-note-content");
      await expect(noteContent).toHaveCSS("max-width", "800px");

      // Formatting controls stay in a full-width row above the editor, with
      // the frequently used controls visible and the rest in the More menu.
      const toolbar = page.locator(".masar-note-toolbar-scroll");
      await expect(toolbar).toBeVisible();
      for (const label of [
        "Undo",
        "Redo",
        "Paragraph",
        "Heading 1",
        "Heading 2",
        "Heading 3",
        "Bold",
        "Italic",
        "Underline",
        "Bulleted list",
        "Numbered list",
        "Checklist",
        "Quote",
        "Highlight",
        "Insert link",
        "Insert image",
        "Narrow note width",
        "Standard note width",
        "Wide note width",
        "More formatting",
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

      // The three widths are meaningfully different and persist.
      await toolbar.getByRole("button", { name: "Narrow note width" }).click();
      await expect(noteContent).toHaveCSS("max-width", "640px");
      await toolbar.getByRole("button", { name: "Wide note width" }).click();
      await expect(noteContent).toHaveCSS("max-width", "1040px");
      await toolbar.getByRole("button", { name: "Standard note width" }).click();
      await expect(noteContent).toHaveCSS("max-width", "800px");

      // Undo and redo from the toolbar.
      await page.keyboard.type(" extra");
      await toolbar.getByRole("button", { name: "Undo" }).click();
      await expect(editor).not.toContainText(" extra");
      await toolbar.getByRole("button", { name: "Redo" }).click();
      await expect(editor).toContainText("Hello from the note extra");
      await toolbar.getByRole("button", { name: "Undo" }).click();
      await expect(editor).not.toContainText(" extra");

      // Secondary formatting lives in the More menu.
      await toolbar.getByRole("button", { name: "More formatting" }).click();
      for (const label of [
        "Strikethrough",
        "Inline code",
        "Code block",
        "Divider",
        "Table",
        "Align left",
        "Align center",
        "Align right",
        "Justify",
      ]) {
        await expect(
          page.getByRole("menuitem", { name: label, exact: true }),
        ).toBeVisible();
      }

      // Divider and table insert real blocks.
      await page.getByRole("menuitem", { name: "Divider" }).click();
      await expect(editor.locator('[data-content-type="divider"]').first()).toBeVisible();
      await toolbar.getByRole("button", { name: "More formatting" }).click();
      await page.getByRole("menuitem", { name: "Table" }).click();
      await expect(editor.locator('[data-content-type="table"]').first()).toBeVisible();
      await page.keyboard.press("Escape");

      // Checklist blocks are available from the toolbar. Click into the
      // paragraph (not the heading) so the round trip leaves the heading
      // intact for the outline checks below.
      await editor.locator('[data-content-type="paragraph"]').first().click();
      await toolbar.getByRole("button", { name: "Checklist" }).click();
      await expect(
        editor.locator('[data-content-type="checkListItem"]').first(),
      ).toBeVisible();
      await toolbar.getByRole("button", { name: "Paragraph" }).click();

      // The outline lists the note's headings.
      await page.getByRole("button", { name: "Show outline" }).click();
      const outline = page.getByRole("complementary", { name: "Note outline" });
      await expect(outline).toBeVisible();
      await expect(outline).toContainText("Hello from the note");
      await page.getByRole("button", { name: "Close outline" }).click();
      await expect(outline).toHaveCount(0);

      // Links are validated before they are applied.
      await toolbar.getByRole("button", { name: "Insert link" }).click();
      await page.getByLabel("Link URL").fill("javascript:alert(1)");
      await page.getByRole("button", { name: "Apply" }).click();
      await expect(
        page.getByText("Only https://, http://, mailto: and tel: links are allowed."),
      ).toBeVisible();
      await page.getByLabel("Link URL").fill("example.com");
      await page.getByRole("button", { name: "Apply" }).click();
      await expect(editor.locator('a[href="https://example.com"]')).toBeVisible();
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();

      // Content persists across a reload, including the width preference.
      await page.reload({ waitUntil: "networkidle" });
      await expect(page.locator(".masar-note .bn-editor")).toContainText(
        "Hello from the note",
      );
      await expect(page.locator(".masar-note-content")).toHaveCSS(
        "max-width",
        "800px",
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

  test("shows an error for damaged note content without overwriting it", async ({
    page,
  }) => {
    const noteName = uniqueName("E2E Damaged Note");
    let boardId: string | undefined;

    try {
      const board = await createBoard(page.request, noteName, {
        type: "note",
      });
      boardId = board.id;

      // Store an unparseable payload directly through the API.
      const damaged = await page.request.put(`/api/boards/${boardId}/document`, {
        data: { document: "{broken json" },
      });
      expect(damaged.ok()).toBeTruthy();

      await page.goto(`/boards/${boardId}`);
      await expect(
        page.getByText("This note could not be read"),
      ).toBeVisible();
      // No editor is mounted, so nothing can overwrite the damaged payload.
      await expect(page.locator(".masar-note .bn-editor")).toHaveCount(0);

      const stored = await page.request.get(`/api/boards/${boardId}/document`);
      const body = (await stored.json()) as { document: { document: string } };
      expect(body.document.document).toBe("{broken json");
    } finally {
      if (boardId) await deleteBoard(page.request, boardId);
    }
  });

  test("keeps unsaved edits when switching notes before autosave lands", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const noteA = uniqueName("E2E Switch A");
    const noteB = uniqueName("E2E Switch B");
    let boardA: string | undefined;
    let boardB: string | undefined;

    try {
      const a = await createBoard(page.request, noteA, { type: "note" });
      const b = await createBoard(page.request, noteB, { type: "note" });
      boardA = a.id;
      boardB = b.id;

      await page.goto("/");
      await page
        .getByRole("link", { name: new RegExp(noteA) })
        .first()
        .click();
      await expect(page).toHaveURL(new RegExp(`/boards/${a.id}$`));

      // Type and switch away immediately — before the 1.2s autosave debounce
      // can persist anything.
      const editorA = page.locator(".masar-note .bn-editor");
      await editorA.click();
      await page.keyboard.type("Unsaved work in A");
      await page
        .getByRole("link", { name: new RegExp(noteB) })
        .first()
        .click();
      await expect(page).toHaveURL(new RegExp(`/boards/${b.id}$`));
      await expect(page.locator(".masar-note .bn-editor")).toBeVisible();

      // Come back to A: the unsaved work must have survived the switch.
      await page
        .getByRole("link", { name: new RegExp(noteA) })
        .first()
        .click();
      await expect(page).toHaveURL(new RegExp(`/boards/${a.id}$`));
      await expect(page.locator(".masar-note .bn-editor")).toContainText(
        "Unsaved work in A",
      );
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();

      // And it persists for real after a reload.
      await page.reload({ waitUntil: "networkidle" });
      await expect(page.locator(".masar-note .bn-editor")).toContainText(
        "Unsaved work in A",
      );

      expect(errors).toEqual([]);
    } finally {
      if (boardA) await deleteBoard(page.request, boardA);
      if (boardB) await deleteBoard(page.request, boardB);
    }
  });

  test("uploads images dropped anywhere on the note surface", async ({
    page,
  }) => {
    const noteName = uniqueName("E2E Note Drop");
    let boardId: string | undefined;

    try {
      const board = await createBoard(page.request, noteName, { type: "note" });
      boardId = board.id;

      await page.goto(`/boards/${boardId}`);
      const editor = page.locator(".masar-note .bn-editor");
      await expect(editor).toBeVisible();
      await editor.click();
      await page.keyboard.type("Drop images across the whole note");
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();

      const content = page.locator(".masar-note-content");
      const contentBox = await content.boundingBox();
      const editorBox = await editor.boundingBox();
      if (!contentBox || !editorBox) {
        throw new Error("Could not measure the note surface");
      }

      const dropImage = async (
        point: { clientX: number; clientY: number },
        name: string,
      ) => {
        const dataTransfer = await page.evaluateHandle(
          ({ base64, fileName }) => {
            const bytes = Uint8Array.from(atob(base64), (char) =>
              char.charCodeAt(0),
            );
            const transfer = new DataTransfer();
            transfer.items.add(new File([bytes], fileName, { type: "image/png" }));
            return transfer;
          },
          { base64: PNG.toString("base64"), fileName: name },
        );
        await content.dispatchEvent("dragenter", { dataTransfer, ...point });
        await content.dispatchEvent("dragover", { dataTransfer, ...point });
        await content.dispatchEvent("drop", { dataTransfer, ...point });
        await dataTransfer.dispose();
      };

      // The reading column's left padding is outside BlockNote's editable
      // element, which is where drops previously did nothing.
      await dropImage(
        { clientX: contentBox.x + 2, clientY: editorBox.y + 10 },
        "left-margin.png",
      );
      await expect(
        editor.locator('[data-content-type="image"]'),
      ).toHaveCount(1);

      // Empty space below the document is outside the editor element too.
      const grownContentBox = await content.boundingBox();
      if (!grownContentBox) {
        throw new Error("Could not measure the note content");
      }
      await dropImage(
        {
          clientX: grownContentBox.x + grownContentBox.width / 2,
          clientY: grownContentBox.y + grownContentBox.height + 24,
        },
        "bottom-margin.png",
      );
      await expect(
        editor.locator('[data-content-type="image"]'),
      ).toHaveCount(2);
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();

      await page.reload({ waitUntil: "networkidle" });
      await expect(
        page.locator('.masar-note .bn-editor [data-content-type="image"]'),
      ).toHaveCount(2);
    } finally {
      if (boardId) await deleteBoard(page.request, boardId);
    }
  });
});
