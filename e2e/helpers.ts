import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const E2E_PASSWORD = "Masar-e2e-password-2026";
export const E2E_ORIGIN = "http://localhost:3100";

export interface TestAccount {
  name: string;
  email: string;
  password: string;
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
 * Creates an account through Better Auth. Pass `page.request` so the session
 * cookie lands in the browser context used by the test.
 */
export async function signUp(
  request: APIRequestContext,
  overrides: Partial<TestAccount> = {},
): Promise<TestAccount> {
  const account: TestAccount = {
    name: overrides.name ?? "E2E User",
    email: overrides.email ?? uniqueEmail(),
    password: overrides.password ?? E2E_PASSWORD,
  };

  const response = await request.post("/api/auth/sign-up/email", {
    data: {
      name: account.name,
      email: account.email,
      password: account.password,
    },
    headers: authHeaders(),
  });

  expect(
    response.ok(),
    `Sign-up failed with ${response.status()}: ${await response.text()}`,
  ).toBeTruthy();

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
