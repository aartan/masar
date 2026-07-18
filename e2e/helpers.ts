import { expect, type APIRequestContext, type Page } from "@playwright/test";

export interface ApiBoard {
  id: string;
  name: string;
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
    assignee?: string | null;
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
