import { expect, test } from "@playwright/test";

import { createBoard, deleteBoard, uniqueName } from "./helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=",
  "base64",
);

test("shows image storage feedback while a whiteboard scene saves", async ({
  page,
}) => {
  const boardName = uniqueName("E2E Whiteboard Upload");
  let boardId: string | undefined;

  try {
    const board = await createBoard(page.request, boardName, {
      type: "whiteboard",
    });
    boardId = board.id;

    // Hold the scene save so the in-progress dock is observable. The free
    // workspace has no R2 credentials, so the image is expected to settle as a
    // local copy.
    await page.route("**/api/boards/*/scene", async (route) => {
      if (route.request().method() === "PUT") {
        await new Promise((resolve) => setTimeout(resolve, 1_200));
      }
      await route.continue();
    });

    await page.goto(`/boards/${boardId}`);
    const whiteboard = page.locator(".masar-whiteboard");
    await expect(whiteboard).toBeVisible();
    await expect(whiteboard.locator("canvas").first()).toBeVisible();

    const canvas = whiteboard.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Could not measure the whiteboard canvas");
    const dataTransfer = await page.evaluateHandle(
      ({ base64, fileName }) => {
        const bytes = Uint8Array.from(atob(base64), (char) =>
          char.charCodeAt(0),
        );
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([bytes], fileName, { type: "image/png" }),
        );
        return transfer;
      },
      { base64: PNG.toString("base64"), fileName: "canvas.png" },
    );
    const point = {
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height / 2,
    };
    await canvas.dispatchEvent("dragenter", { dataTransfer, ...point });
    await canvas.dispatchEvent("dragover", { dataTransfer, ...point });
    await canvas.dispatchEvent("drop", { dataTransfer, ...point });
    await dataTransfer.dispose();

    await expect(page.getByText(/Saving 1 image/)).toBeVisible();
    await expect(page.getByText(/Stored on this device/)).toBeVisible();

    await expect
      .poll(async () => {
        const response = await page.request.get(
          `/api/boards/${boardId}/scene`,
        );
        const body = (await response.json()) as {
          scene: { scene: string };
        };
        const scene = JSON.parse(body.scene.scene || "{}") as {
          files?: Record<string, { dataURL?: unknown }>;
        };
        return Object.values(scene.files ?? {}).some(
          (file) =>
            typeof file.dataURL === "string" &&
            file.dataURL.startsWith("data:image/"),
        );
      })
      .toBe(true);
  } finally {
    if (boardId) await deleteBoard(page.request, boardId);
  }
});
