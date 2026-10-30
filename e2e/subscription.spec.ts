import { expect, test } from "@playwright/test";

import { collectPageErrors, signUp } from "./helpers";

test.describe("subscription access", () => {
  test("an active subscriber can reach the workspace and billing page", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await signUp(page.request, { subscription: "active" });

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Subscription" }).click();
    await expect(page).toHaveURL(/\/subscription$/);
    await expect(
      page.getByRole("heading", { name: "Subscription & billing" }),
    ).toBeVisible();
    await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Masar Pro", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Back to workspace" }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(errors).toEqual([]);
  });

  test("an expired user is redirected to billing and workspace APIs return 402", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await signUp(page.request, { subscription: "canceled" });

    await page.goto("/");
    await expect(page).toHaveURL(/\/subscription\?required=1$/);
    await expect(
      page.getByText(/An active subscription or trial is required/),
    ).toBeVisible();
    await expect(page.getByText("Canceled", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Your data is safe/)).toBeVisible();

    const boards = await page.request.get("/api/boards");
    expect(boards.status()).toBe(402);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(errors).toEqual([]);
  });

  test("a scheduled cancellation keeps access and shows the end date", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await signUp(page.request, { subscription: "canceling" });

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.goto("/subscription");
    await expect(page.getByText("Canceling", { exact: true })).toBeVisible();
    await expect(page.getByText(/Cancels on .*Access continues until then/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to workspace" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("an incomplete checkout restricts access without creating a workspace", async ({
    page,
  }) => {
    await signUp(page.request, { subscription: "incomplete" });

    await page.goto("/");
    await expect(page).toHaveURL(/\/subscription\?required=1$/);
    await expect(page.getByText("Incomplete", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Checkout was not completed.")).toBeVisible();
  });
});
