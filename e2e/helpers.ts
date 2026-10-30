import { randomUUID } from "node:crypto";

import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { hashPassword } from "better-auth/crypto";

import * as schema from "../src/db/schema";

export const E2E_PASSWORD = "Masar-e2e-password-2026";
export const E2E_ORIGIN = "http://localhost:3100";
const E2E_DATABASE_URL = "file:./data/e2e.db";

export interface TestAccount {
  name: string;
  email: string;
  password: string;
}

export type SeedSubscriptionStatus =
  | "trialing"
  | "active"
  | "canceling"
  | "canceled"
  | "incomplete"
  | "none";

export interface SeedAccountOptions extends Partial<TestAccount> {
  subscription?: SeedSubscriptionStatus;
}

export interface ApiBoard {
  id: string;
  name: string;
}

function authHeaders() {
  return { Origin: E2E_ORIGIN };
}

export function uniqueEmail(prefix = "e2e"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}@example.test`;
}

/**
 * Creates a Better Auth-compatible account directly in the E2E SQLite file,
 * with a subscription unless requested otherwise. Public sign-up is disabled
 * because accounts may only be created after Stripe Checkout, which is not
 * available in the Playwright server.
 */
export async function seedAccount(
  overrides: SeedAccountOptions = {},
): Promise<TestAccount> {
  const account: TestAccount = {
    name: overrides.name ?? "E2E User",
    email: overrides.email ?? uniqueEmail(),
    password: overrides.password ?? E2E_PASSWORD,
  };
  const subscriptionStatus = overrides.subscription ?? "trialing";
  const now = new Date();
  const future = new Date(now.getTime() + 86_400_000 * 14);
  const past = new Date(now.getTime() - 86_400_000);
  const userId = randomUUID();
  const passwordHash = await hashPassword(account.password);

  const client = createClient({ url: E2E_DATABASE_URL });
  const db = drizzle(client, { schema });
  try {
    await db.insert(schema.users).values({
      id: userId,
      name: account.name,
      email: account.email,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.accounts).values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });

    if (subscriptionStatus !== "none") {
      const customerId = `cus_e2e_${randomUUID()}`;
      await db.insert(schema.billingCustomers).values({
        id: randomUUID(),
        userId,
        stripeCustomerId: customerId,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.subscriptions).values({
        id: randomUUID(),
        userId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: `sub_e2e_${randomUUID()}`,
        stripePriceId: "price_e2e",
        status:
          subscriptionStatus === "canceling" ? "active" : subscriptionStatus,
        planName: "Masar Pro",
        currency: "usd",
        amount: 1200,
        interval: "month",
        currentPeriodEnd:
          subscriptionStatus === "incomplete"
            ? null
            : subscriptionStatus === "canceled"
              ? past
              : future,
        trialStart: subscriptionStatus === "trialing" ? now : null,
        trialEnd: subscriptionStatus === "trialing" ? future : null,
        cancelAtPeriodEnd: subscriptionStatus === "canceling",
        canceledAt: subscriptionStatus === "canceled" ? past : null,
        stripeCreatedAt: past,
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
  } finally {
    client.close();
  }

  return account;
}

/**
 * Seeds an account with an entitled subscription and signs it in. Existing
 * tests use this in place of the now-disabled public sign-up endpoint.
 */
export async function signUp(
  request: APIRequestContext,
  overrides: SeedAccountOptions = {},
): Promise<TestAccount> {
  const account = await seedAccount(overrides);
  await signIn(request, account);
  return account;
}

export async function signIn(
  request: APIRequestContext,
  account: Pick<TestAccount, "email" | "password">,
): Promise<void> {
  const response = await request.post("/api/auth/sign-in/email", {
    data: { email: account.email, password: account.password },
    headers: authHeaders(),
  });

  expect(
    response.ok(),
    `Sign-in failed with ${response.status()}: ${await response.text()}`,
  ).toBeTruthy();
}

export async function signOut(request: APIRequestContext): Promise<void> {
  const response = await request.post("/api/auth/sign-out", {
    data: {},
    headers: authHeaders(),
  });
  expect(
    response.ok(),
    `Sign-out failed with ${response.status()}: ${await response.text()}`,
  ).toBeTruthy();
}

export interface ApiColumn {
  id: string;
  name: string;
  isDone: boolean;
}

export interface ApiTask {
  id: string;
  title: string;
  columnId: string;
}

export async function createBoard(
  request: APIRequestContext,
  name: string,
): Promise<ApiBoard> {
  const response = await request.post("/api/boards", { data: { name } });
  expect(
    response.ok(),
    `Board creation failed with ${response.status()}`,
  ).toBeTruthy();
  const body = (await response.json()) as { board: ApiBoard };
  return body.board;
}

export async function getBoardDetail(
  request: APIRequestContext,
  boardId: string,
): Promise<{ columns: ApiColumn[]; tasks: ApiTask[] }> {
  const response = await request.get(`/api/boards/${boardId}`);
  expect(
    response.ok(),
    `Board fetch failed with ${response.status()}`,
  ).toBeTruthy();
  const body = (await response.json()) as {
    board: { columns: ApiColumn[]; tasks: ApiTask[] };
  };
  return body.board;
}

export async function createTask(
  request: APIRequestContext,
  boardId: string,
  input: {
    columnId: string;
    title: string;
    priority?: string;
    dueDate?: string | null;
  },
): Promise<ApiTask> {
  const response = await request.post(`/api/boards/${boardId}/tasks`, {
    data: input,
  });
  expect(
    response.ok(),
    `Task creation failed with ${response.status()}`,
  ).toBeTruthy();
  const body = (await response.json()) as { task: ApiTask };
  return body.task;
}

export async function deleteBoard(
  request: APIRequestContext,
  boardId: string,
): Promise<void> {
  await request.delete(`/api/boards/${boardId}`);
}

export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
  return errors;
}

export function columnByName(
  columns: ApiColumn[],
  name: string,
): ApiColumn {
  const column = columns.find((item) => item.name === name);
  if (!column) throw new Error(`Column ${name} not found`);
  return column;
}
