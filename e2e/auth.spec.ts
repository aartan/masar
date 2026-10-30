import { expect, test } from "@playwright/test";

import {
  collectPageErrors,
  columnByName,
  createBoard,
  createTask,
  getBoardDetail,
  signIn,
  signOut,
  signUp,
  uniqueEmail,
  uniqueName,
} from "./helpers";

test.describe("authentication and workspace privacy", () => {
  test("shows friendly messages for missing and malformed emails", async ({
    page,
  }) => {
    await page.goto("/login");

    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "Enter your email address.",
    );

    await page.getByLabel("Email", { exact: true }).fill("not-an-email");
    await page
      .getByLabel("Password", { exact: true })
      .fill("Masar-auth-password-2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "Enter a valid email address.",
    );
  });

  test("redirects anonymous visitors, disables direct sign-up, then supports sign-out and sign-in", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const account = {
      name: "Ada Lovelace",
      email: uniqueEmail("auth"),
      password: "Masar-auth-password-2026",
    };

    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("heading", { name: "Sign in to Masar" }),
    ).toBeVisible();

    const unauthorized = await page.request.get("/api/boards");
    expect(unauthorized.status()).toBe(401);

    // Accounts can only be created after Stripe confirms a subscription.
    const direct = await page.request.post("/api/auth/sign-up/email", {
      data: {
        name: "Bypass Attempt",
        email: uniqueEmail("bypass"),
        password: "Masar-bypass-password-2026",
      },
      headers: { Origin: "http://localhost:3100" },
    });
    expect(direct.ok()).toBeFalsy();

    await signUp(page.request, account);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Account menu" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByText(account.email)).toBeVisible();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("demo content can be added explicitly to an empty workspace", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const account = {
      name: "Grace Hopper",
      email: uniqueEmail("demo"),
      password: "Masar-demo-password-2026",
    };

    await signUp(page.request, account);
    await page.goto("/");
    await expect(page.getByText("No boards yet.")).toBeVisible();

    const response = await page.request.post("/api/onboarding/demo");
    expect(response.ok()).toBeTruthy();
    await page.reload();

    const demoTile = page
      .locator("aside")
      .getByRole("link", { name: /Welcome to Masar/ });
    await expect(demoTile).toBeVisible();
    await demoTile.click();

    await expect(
      page.getByRole("heading", { name: "Welcome to Masar" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open task: Plan your first project" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("another account cannot see or access a private board", async ({ page }) => {
    const errors = collectPageErrors(page);
    const boardName = uniqueName("Private board");

    const first = await signUp(page.request, {
      name: "First Owner",
      email: uniqueEmail("first"),
    });
    const board = await createBoard(page.request, boardName);
    const detail = await getBoardDetail(page.request, board.id);
    const todo = columnByName(detail.columns, "To Do");
    const task = await createTask(page.request, board.id, {
      columnId: todo.id,
      title: "Confidential task",
    });

    await signOut(page.request);
    const second = await signUp(page.request, {
      name: "Second Owner",
      email: uniqueEmail("second"),
    });
    expect(second.email).not.toBe(first.email);

    await page.goto("/");
    await expect(
      page.getByText("Your workspace is ready for its first board."),
    ).toBeVisible();
    await expect(
      page.locator("aside").getByRole("link", { name: boardName }),
    ).toHaveCount(0);

    const list = await page.request.get("/api/boards");
    expect(list.ok()).toBeTruthy();
    expect(await list.json()).toEqual({ boards: [] });

    expect((await page.request.get(`/api/boards/${board.id}`)).status()).toBe(
      404,
    );
    expect(
      (
        await page.request.patch(`/api/boards/${board.id}`, {
          data: { name: "Stolen" },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await page.request.patch(`/api/tasks/${task.id}`, {
          data: { title: "Stolen task" },
        })
      ).status(),
    ).toBe(404);

    await page.goto(`/boards/${board.id}`);
    await expect(
      page.getByRole("heading", { name: "This board is not here" }),
    ).toBeVisible();

    // The owner still has the board after the other account's attempt.
    await signOut(page.request);
    await signIn(page.request, first);
    await page.goto("/");
    await expect(
      page.locator("aside").getByRole("link", { name: boardName }),
    ).toBeVisible();
    const ownerView = await page.request.get(`/api/boards/${board.id}`);
    expect(ownerView.ok()).toBeTruthy();

    await page.request.delete(`/api/boards/${board.id}`);
    await page.reload();
    await expect(
      page.locator("aside").getByRole("link", { name: boardName }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
