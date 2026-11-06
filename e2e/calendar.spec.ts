import { expect, test, type Locator, type Page } from "@playwright/test";
import { addDays, format } from "date-fns";

import {
  collectPageErrors,
  columnByName,
  createBoard,
  createTask,
  deleteBoard,
  getBoardDetail,
  uniqueName,
} from "./helpers";

function iso(offset: number): string {
  return format(addDays(new Date(), offset), "yyyy-MM-dd");
}

async function dragTo(page: Page, source: Locator, target: Locator) {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Missing drag geometry");

  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2 + 8,
    sourceBox.y + sourceBox.height / 2 + 8,
    { steps: 4 },
  );
  await page.mouse.move(
    targetBox.x + targetBox.width - 12,
    targetBox.y + targetBox.height - 12,
    { steps: 24 },
  );
  await page.mouse.up();
}

test.describe("calendar view", () => {
  test("shows scheduled and unscheduled work, switches views, opens tasks, and persists drag changes", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const boardName = uniqueName("E2E Calendar");
    let boardId: string | undefined;

    try {
      const board = await createBoard(page.request, boardName);
      boardId = board.id;
      const detail = await getBoardDetail(page.request, boardId);
      const todo = columnByName(detail.columns, "To Do");
      const done = columnByName(detail.columns, "Done");

      const overdue = await createTask(page.request, boardId, {
        columnId: todo.id,
        title: "Calendar overdue",
        dueDate: iso(-1),
      });
      const unscheduled = await createTask(page.request, boardId, {
        columnId: todo.id,
        title: "Calendar unscheduled",
      });
      await createTask(page.request, boardId, {
        columnId: done.id,
        title: "Calendar completed",
        dueDate: iso(2),
      });
      for (const suffix of ["A", "B", "C", "D"]) {
        await createTask(page.request, boardId, {
          columnId: todo.id,
          title: `Calendar upcoming ${suffix}`,
          dueDate: iso(1),
        });
      }

      await page.goto("/");
      await page
        .locator("aside")
        .getByRole("link", { name: "Calendar", exact: true })
        .click();
      await expect(page).toHaveURL(/\/calendar$/);
      await expect(
        page.getByRole("heading", { name: "Calendar", level: 1 }),
      ).toBeVisible();

      const unscheduledPanel = page.getByRole("region", {
        name: "Unscheduled tasks",
      });
      await expect(unscheduledPanel.getByText("1", { exact: true })).toBeVisible();
      await expect(
        unscheduledPanel.getByRole("button", {
          name: "Open task: Calendar unscheduled",
        }),
      ).toBeVisible();

      await expect(
        page.getByRole("button", { name: "Open task: Calendar overdue" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Open task: Calendar completed" }),
      ).toBeVisible();
      const moreTasks = page
        .getByRole("button", {
          name: `Show 2 more tasks on ${format(addDays(new Date(), 1), "MMMM d")}`,
        })
        .filter({ visible: true });
      await expect(moreTasks).toHaveText("+2 more");

      // Clicking "+N more" drills into the full day.
      await moreTasks.click();
      await expect(
        page.getByRole("button", { name: "Day", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.getByRole("button", {
          name: "Open task: Calendar upcoming D",
        }),
      ).toBeVisible();

      // Week and month toggles keep the same task data.
      await page.getByRole("button", { name: "Week", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Week", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.getByRole("button", { name: "Open task: Calendar overdue" }),
      ).toBeVisible();

      await page.getByRole("button", { name: "Month", exact: true }).click();

      // Task chips open the existing detail sheet.
      await page
        .getByRole("button", { name: "Open task: Calendar overdue" })
        .click();
      const sheet = page.getByRole("dialog", { name: "Task details" });
      await expect(sheet).toBeVisible();
      await expect(
        sheet.getByRole("textbox", { name: "Task title" }),
      ).toHaveValue("Calendar overdue");
      await sheet.getByRole("button", { name: "Close task details" }).click();
      await expect(sheet).toHaveCount(0);

      // Schedule an unscheduled task by dragging it onto a date.
      const firstPatch = page.waitForResponse(
        (response) =>
          /\/api\/tasks\/[^/]+$/.test(new URL(response.url()).pathname) &&
          response.request().method() === "PATCH",
      );
      await dragTo(
        page,
        unscheduledPanel.getByRole("button", {
          name: "Open task: Calendar unscheduled",
        }),
        page.locator('[data-date="' + iso(1) + '"]'),
      );
      const firstResponse = await firstPatch;
      expect(firstResponse.ok()).toBe(true);
      expect(
        (
          (await firstResponse.json()) as {
            task: { dueDate: string | null };
          }
        ).task.dueDate,
      ).toBe(iso(1));
      await expect(
        unscheduledPanel.getByText("Everything is scheduled"),
      ).toBeVisible();

      // Move a scheduled task to another date.
      const secondPatch = page.waitForResponse(
        (response) =>
          /\/api\/tasks\/[^/]+$/.test(new URL(response.url()).pathname) &&
          response.request().method() === "PATCH",
      );
      await dragTo(
        page,
        page.getByRole("button", { name: "Open task: Calendar overdue" }),
        page.locator('[data-date="' + iso(3) + '"]'),
      );
      const secondResponse = await secondPatch;
      expect(secondResponse.ok()).toBe(true);
      expect(
        (
          (await secondResponse.json()) as {
            task: { dueDate: string | null };
          }
        ).task.dueDate,
      ).toBe(iso(3));

      // Reload proves both drops went through the normal task data layer.
      await page.reload({ waitUntil: "networkidle" });
      const calendarResponse = await page.request.get("/api/calendar");
      expect(calendarResponse.ok()).toBe(true);
      const calendar = (await calendarResponse.json()) as {
        calendar: { tasks: Array<{ id: string; dueDate: string | null }> };
      };
      expect(
        calendar.calendar.tasks.find((task) => task.id === unscheduled.id)
          ?.dueDate,
      ).toBe(iso(1));
      expect(
        calendar.calendar.tasks.find((task) => task.id === overdue.id)?.dueDate,
      ).toBe(iso(3));
      await expect(
        page
          .getByRole("region", { name: "Unscheduled tasks" })
          .getByText("0", { exact: true }),
      ).toBeVisible();

      expect(errors).toEqual([]);
    } finally {
      if (boardId) await deleteBoard(page.request, boardId);
    }
  });

  test("is responsive and exposes the unscheduled list on mobile", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const boardName = uniqueName("E2E Calendar Mobile");
    let boardId: string | undefined;

    try {
      const board = await createBoard(page.request, boardName);
      boardId = board.id;
      const detail = await getBoardDetail(page.request, boardId);
      const todo = columnByName(detail.columns, "To Do");
      await createTask(page.request, boardId, {
        columnId: todo.id,
        title: "Mobile unscheduled",
      });
      await createTask(page.request, boardId, {
        columnId: todo.id,
        title: "Mobile scheduled",
        dueDate: iso(0),
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      await page.getByRole("button", { name: "Open navigation" }).click();
      const nav = page.getByRole("dialog", { name: "Navigation" });
      await nav.getByRole("link", { name: "Calendar", exact: true }).click();

      await expect(page).toHaveURL(/\/calendar$/);
      await expect(
        page.getByRole("heading", { name: "Calendar", level: 1 }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Month", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Week", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Day", exact: true }),
      ).toBeVisible();

      const mobilePanel = page.getByRole("region", {
        name: "Unscheduled tasks",
      });
      await expect(mobilePanel.getByText("1", { exact: true })).toBeVisible();
      await mobilePanel
        .getByRole("button", { name: "Expand unscheduled tasks" })
        .click();
      await expect(
        mobilePanel.getByRole("button", {
          name: "Open task: Mobile unscheduled",
        }),
      ).toBeVisible();

      // Month cells collapse to dots on phones; the day view exposes the
      // scheduled tasks and still opens the shared task sheet.
      const todayLabel = format(new Date(), "EEEE, MMMM d, yyyy");
      await page
        .getByRole("button", { name: `Open ${todayLabel}` })
        .click();
      await expect(
        page.getByRole("button", { name: "Day", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      const scheduledChip = page.getByRole("button", {
        name: "Open task: Mobile scheduled",
      });
      await expect(scheduledChip).toBeVisible();
      await scheduledChip.click();
      await expect(
        page.getByRole("dialog", { name: "Task details" }),
      ).toBeVisible();

      expect(errors).toEqual([]);
    } finally {
      if (boardId) await deleteBoard(page.request, boardId);
    }
  });
});
