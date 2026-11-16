import { expect, test } from "@playwright/test";

import { createBoard, deleteBoard, uniqueName } from "./helpers";

function paragraph(id: string, text: string) {
  return {
    id,
    type: "paragraph",
    props: {
      textColor: "default",
      backgroundColor: "default",
      textAlignment: "left",
    },
    content: [{ type: "text", text, styles: {} }],
  };
}

const CURSOR_DOCUMENT = JSON.stringify([
  paragraph("line-1", "First line of the note"),
  paragraph("line-2", "Second line with more words"),
  paragraph("line-3", "Third line here"),
  paragraph("line-4", "Fourth line here"),
]);

test.describe("note cursor behaviour", () => {
  test("positions the caret from clicks across the whole note canvas", async ({
    page,
  }) => {
    const noteName = uniqueName("E2E Note Cursor");
    let boardId: string | undefined;

    try {
      const board = await createBoard(page.request, noteName, { type: "note" });
      boardId = board.id;
      await page.request.put(`/api/boards/${boardId}/document`, {
        data: { document: CURSOR_DOCUMENT },
      });

      await page.goto(`/boards/${boardId}`);
      const editor = page.locator(".masar-note .bn-editor");
      const canvas = page.locator('.masar-note [data-note-editable="true"]');
      const content = page.locator(".masar-note-content");
      await expect(editor).toBeVisible();
      await expect(canvas).toBeVisible();

      // The editable surface and its blank margins show a text cursor.
      await expect(editor).toHaveCSS("cursor", "text");
      await expect(canvas).toHaveCSS("cursor", "text");
      await expect(content).toHaveCSS("cursor", "text");

      // Opening an existing note must not steal focus.
      await expect
        .poll(() =>
          page.evaluate(() =>
            Boolean(document.activeElement?.closest(".bn-editor")),
          ),
        )
        .toBe(false);

      const lines = editor.locator('[data-content-type="paragraph"]');
      await expect(lines).toHaveCount(4);

      // Clicking a different line moves the caret there.
      const third = await lines.nth(2).boundingBox();
      if (!third) throw new Error("Could not measure the third line");
      await page.mouse.click(third.x + 25, third.y + third.height / 2);
      await page.keyboard.type("X");
      await expect(lines.nth(2)).toContainText("X");

      // Empty space below the document is still part of the writing canvas.
      const editorBox = await editor.boundingBox();
      if (!editorBox) throw new Error("Could not measure the editor");
      await page.mouse.click(
        editorBox.x + editorBox.width / 2,
        editorBox.y + editorBox.height - 30,
      );
      await page.keyboard.type("END");
      // BlockNote turns a click on the trailing block into a new paragraph
      // at the end of the document, so the text lands on its own line.
      await expect(lines.nth(3)).toHaveText("Fourth line here");
      await expect(lines.nth(4)).toHaveText("END");

      // Clicks in the column's side padding also place the caret there, even
      // when the editor is not focused yet.
      await page.getByRole("heading", { level: 1, name: noteName }).click();
      const contentBox = await content.boundingBox();
      const second = await lines.nth(1).boundingBox();
      if (!contentBox || !second) {
        throw new Error("Could not measure the note content");
      }
      await page.mouse.click(contentBox.x + 2, second.y + second.height / 2);
      await page.keyboard.type("START");
      await expect(lines.nth(1)).toContainText(
        "STARTSecond line with more words",
      );
    } finally {
      if (boardId) await deleteBoard(page.request, boardId);
    }
  });

  test("opens an existing note without focusing or scrolling to the end", async ({
    page,
  }) => {
    const noteName = uniqueName("E2E Note Open");
    let boardId: string | undefined;

    try {
      const board = await createBoard(page.request, noteName, { type: "note" });
      boardId = board.id;
      const document = JSON.stringify(
        Array.from({ length: 40 }, (_, index) =>
          paragraph(`line-${index}`, `Paragraph ${index + 1}`),
        ),
      );
      await page.request.put(`/api/boards/${boardId}/document`, {
        data: { document },
      });

      await page.goto(`/boards/${boardId}`);
      const editor = page.locator(".masar-note .bn-editor");
      await expect(editor).toBeVisible();
      await expect(
        editor.locator('[data-content-type="paragraph"]'),
      ).toHaveCount(40);

      const state = await page.evaluate(() => {
        const scroll = document.querySelector(
          ".masar-note-content",
        )?.parentElement;
        return {
          focused: Boolean(document.activeElement?.closest(".bn-editor")),
          scrollTop: scroll?.scrollTop ?? -1,
        };
      });
      expect(state.focused).toBe(false);
      expect(state.scrollTop).toBe(0);

      // Content is still editable immediately after clicking it.
      await editor
        .locator('[data-content-type="paragraph"]')
        .first()
        .click();
      await page.keyboard.type("TOP");
      // The click lands after the text, so typing appends to that line.
      await expect(
        editor.locator('[data-content-type="paragraph"]').first(),
      ).toContainText("Paragraph 1TOP");
    } finally {
      if (boardId) await deleteBoard(page.request, boardId);
    }
  });

  test("saves immediately with Cmd/Ctrl+S instead of opening the browser dialog", async ({
    page,
  }) => {
    const noteName = uniqueName("E2E Note Save");
    let boardId: string | undefined;

    try {
      const board = await createBoard(page.request, noteName, { type: "note" });
      boardId = board.id;
      await page.request.put(`/api/boards/${boardId}/document`, {
        data: { document: CURSOR_DOCUMENT },
      });

      await page.goto(`/boards/${boardId}`);
      const editor = page.locator(".masar-note .bn-editor");
      await expect(editor).toBeVisible();
      await editor.locator('[data-content-type="paragraph"]').first().click();
      await page.keyboard.type("!");

      const startedAt = Date.now();
      const saveRequest = page.waitForRequest(
        (request) =>
          request.method() === "PUT" &&
          request.url().endsWith(`/api/boards/${boardId}/document`),
        { timeout: 2_000 },
      );
      await page.keyboard.press("Control+s");
      await saveRequest;
      // The autosave debounce is 1.2s; a request well before that proves the
      // shortcut flushed the pending document instead of letting it wait.
      expect(Date.now() - startedAt).toBeLessThan(1_000);
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    } finally {
      if (boardId) await deleteBoard(page.request, boardId);
    }
  });
});
