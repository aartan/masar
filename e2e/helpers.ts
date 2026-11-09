import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const E2E_ORIGIN = "http://127.0.0.1:3100";

export interface ApiBoard {
  id: string;
  name: string;
  projectId: string | null;
  type: "kanban" | "whiteboard" | "note";
}

export interface ApiProject {
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

export async function createProject(
  request: APIRequestContext,
  name: string,
  description?: string,
): Promise<ApiProject> {
  const response = await request.post("/api/projects", {
    data: { name, ...(description ? { description } : {}) },
  });
  expect(response.ok(), `Project creation failed with ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as { project: ApiProject };
  return body.project;
}

export async function deleteProject(
  request: APIRequestContext,
  projectId: string,
): Promise<void> {
  const archive = await request.post(`/api/projects/${projectId}/archive`);
  expect(archive.ok(), `Project archive failed with ${archive.status()}`).toBeTruthy();
  const detail = await request.get(`/api/projects/${projectId}`);
  expect(detail.ok(), `Project fetch failed with ${detail.status()}`).toBeTruthy();
  const body = (await detail.json()) as { project: { project: { name: string } } };
  const remove = await request.delete(`/api/projects/${projectId}`, {
    data: { confirmation: body.project.project.name },
  });
  expect(remove.ok(), `Project deletion failed with ${remove.status()}`).toBeTruthy();
}

export async function createBoard(
  request: APIRequestContext,
  name: string,
  options: { projectId?: string; type?: "kanban" | "whiteboard" | "note" } = {},
): Promise<ApiBoard> {
  const response = await request.post("/api/boards", {
    data: { name, ...options },
  });
  expect(response.ok(), `Board creation failed with ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as { board: ApiBoard };
  return body.board;
}

export async function getBoardDetail(
  request: APIRequestContext,
  boardId: string,
): Promise<{ columns: ApiColumn[]; tasks: ApiTask[] }> {
  const response = await request.get(`/api/boards/${boardId}`);
  expect(response.ok(), `Board fetch failed with ${response.status()}`).toBeTruthy();
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
  expect(response.ok(), `Task creation failed with ${response.status()}`).toBeTruthy();
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

/**
 * Browser-only E2E shim for the Electron bridge. It lets tests emit the same
 * sync status transitions that the desktop sync engine sends.
 */
export async function installSyncBridgeMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const listeners = new Set<(status: unknown) => void>();
    (window as unknown as { __masarEmitSync?: (phase: string) => void }).__masarEmitSync =
      (phase: string) => {
        for (const listener of listeners) {
          listener({
            phase,
            lastSyncedAt: null,
            pendingChanges: 0,
            lastError: null,
            lastConflictCount: 0,
            skippedChanges: 0,
          });
        }
      };
    (window as unknown as { masarDesktop?: unknown }).masarDesktop = {
      initialTheme: "system",
      setTheme: async (theme: string) => theme,
      getState: async () => ({
        isDesktop: true,
        mode: "local",
        version: "e2e",
      }),
      getSyncStatus: async () => ({
        phase: "idle",
        lastSyncedAt: null,
        pendingChanges: 0,
        lastError: null,
        lastConflictCount: 0,
        skippedChanges: 0,
      }),
      onSyncStatus: (listener: (status: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      onNavigate: () => () => undefined,
      syncNow: async () => undefined,
      notifyDataChanged: async () => undefined,
    };
  });
}

export async function emitSyncStatus(
  page: Page,
  phase: "syncing" | "idle",
): Promise<void> {
  await page.evaluate((value) => {
    const emit = (
      window as unknown as { __masarEmitSync?: (phase: string) => void }
    ).__masarEmitSync;
    emit?.(value);
  }, phase);
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

export function columnByName(columns: ApiColumn[], name: string): ApiColumn {
  const column = columns.find((item) => item.name === name);
  if (!column) throw new Error(`Column ${name} not found`);
  return column;
}
