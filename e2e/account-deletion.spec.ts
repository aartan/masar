import { expect, test, type Page } from "@playwright/test";

const connectedStatus = {
  connected: true,
  user: {
    id: "user-delete-test",
    name: "Test User",
    email: "delete@example.test",
  },
  entitlement: {
    entitled: true,
    reason: "active",
    status: "active",
    currentPeriodEnd: null,
    trialEnd: null,
    cancelAtPeriodEnd: false,
  },
  subscription: null,
  billingConfigured: true,
  error: null,
};

const disconnectedStatus = {
  connected: false,
  user: null,
  entitlement: null,
  subscription: null,
  billingConfigured: false,
  error: null,
};

type TestWindow = Window & {
  masarDesktop?: unknown;
  __deleteConfirmation?: string;
};

async function installFakeBridge(page: Page, failDeletion = false) {
  await page.addInitScript(
    ({ connected, disconnected, shouldFail }) => {
      const testWindow = window as TestWindow;
      const bridge = {
        initialTheme: "system",
        setTheme: async (theme: string) => theme,
        getState: async () => ({
          isDesktop: true as const,
          mode: "local" as const,
          version: "test",
        }),
        getPremiumStatus: async () => connected,
        login: async () => connected,
        register: async () => connected,
        logout: async () => disconnected,
        deleteAccount: async (confirmation: string) => {
          testWindow.__deleteConfirmation = confirmation;
          if (shouldFail) {
            throw new Error("The account could not be deleted. Try again.");
          }
          return { status: disconnected, cleanupWarning: null };
        },
        startCheckout: async () => ({ url: "https://example.test" }),
        openPortal: async () => ({ url: "https://example.test" }),
        refreshBilling: async () => connected,
        syncNow: async () => ({
          phase: "disconnected",
          lastSyncedAt: null,
          pendingChanges: 0,
          lastError: null,
          lastConflictCount: 0,
          skippedChanges: 0,
        }),
        getSyncStatus: async () => ({
          phase: "disconnected",
          lastSyncedAt: null,
          pendingChanges: 0,
          lastError: null,
          lastConflictCount: 0,
          skippedChanges: 0,
        }),
        importLocalWorkspace: async () => ({ boards: 0, tasks: 0 }),
        notifyDataChanged: async () => undefined,
        onSyncStatus: () => () => undefined,
        onNavigate: () => () => undefined,
      };
      testWindow.masarDesktop = bridge;
    },
    {
      connected: connectedStatus,
      disconnected: disconnectedStatus,
      shouldFail: failDeletion,
    },
  );
}

test("account settings links to the dedicated deletion view and cancel returns", async ({
  page,
}) => {
  await installFakeBridge(page);
  await page.goto("/account");

  await expect(page.getByText("Danger zone")).toHaveCount(0);
  await expect(
    page.getByText("Permanently remove your account and synced data."),
  ).toBeVisible();

  await page.getByRole("link", { name: "Delete account", exact: true }).click();
  await expect(page).toHaveURL(/\/account\/delete$/);
  await expect(
    page.getByRole("heading", { name: "Delete account", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("This action is permanent")).toBeVisible();
  await expect(
    page.getByText("Your offline local workspace is not affected."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/account$/);
});

test("deletion requires the exact DELETE phrase and reports success", async ({
  page,
}) => {
  await installFakeBridge(page);
  await page.goto("/account/delete");

  const confirmButton = page.getByRole("button", {
    name: "Delete account permanently",
  });
  await expect(confirmButton).toBeDisabled();

  const input = page.getByLabel(/type DELETE to confirm/i);
  await input.fill("delete");
  await expect(confirmButton).toBeDisabled();

  await input.fill("DELETE");
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();

  await expect(page.getByText("Account deleted", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Your offline local workspace is still available/),
  ).toBeVisible();

  const confirmation = await page.evaluate(
    () => (window as TestWindow).__deleteConfirmation,
  );
  expect(confirmation).toBe("DELETE");
});

test("deletion errors stay visible on the dedicated view", async ({ page }) => {
  await installFakeBridge(page, true);
  await page.goto("/account/delete");

  await page.getByLabel(/type DELETE to confirm/i).fill("DELETE");
  await page.getByRole("button", { name: "Delete account permanently" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "The account could not be deleted",
  );
  await expect(page.getByText("This action is permanent")).toBeVisible();
});
