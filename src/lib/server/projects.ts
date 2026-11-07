import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import { boards, columns, labels, projects, tasks, whiteboards } from "@/db/schema";
import { ApiError } from "@/lib/api";
import type { ProjectDetail, ProjectSummary } from "@/lib/types";
import type { ProjectCreateInput, ProjectUpdateInput } from "@/lib/validation";
import {
  fetchBoardSummaries,
  fetchProjectSummaries,
  nextProjectPosition,
  requireProject,
} from "./queries";

export async function listProjects(
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<ProjectSummary[]> {
  return fetchProjectSummaries(database, ownerId);
}

async function fetchProjectSummary(
  database: AppDatabase,
  projectId: string,
  ownerId: string,
): Promise<ProjectSummary | null> {
  const all = await fetchProjectSummaries(database, ownerId);
  return all.find((project) => project.id === projectId) ?? null;
}

export async function createProject(
  input: ProjectCreateInput,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<ProjectSummary> {
  const position = await nextProjectPosition(database, ownerId);
  const id = randomUUID();
  const now = new Date();
  await database.insert(projects).values({
    id,
    ownerId,
    name: input.name,
    position,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  const summary = await fetchProjectSummary(database, id, ownerId);
  if (!summary) throw new ApiError("Project could not be created.", 500);
  return summary;
}

/**
 * Create the default project of a brand-new workspace (or return it if one
 * already exists). Used when a board is created without a project so there is
 * always somewhere for boards to live.
 */
export async function ensureDefaultProject(
  ownerId: string,
  name: string,
  database: AppDatabase = getDb(),
): Promise<string> {
  const [existing] = await database
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.ownerId, ownerId))
    .orderBy(asc(projects.position), asc(projects.createdAt))
    .limit(1);
  if (existing) return existing.id;
  const created = await createProject({ name }, ownerId, database);
  return created.id;
}

export async function updateProject(
  projectId: string,
  input: ProjectUpdateInput,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<ProjectSummary> {
  await requireProject(database, projectId, ownerId);
  await database
    .update(projects)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)));
  const summary = await fetchProjectSummary(database, projectId, ownerId);
  if (!summary) throw new ApiError("Project not found.", 404);
  return summary;
}

export async function reorderProjects(
  projectIds: string[],
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<ProjectSummary[]> {
  const rows = await database
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.ownerId, ownerId));

  const existing = new Set(rows.map((row) => row.id));
  const incoming = new Set(projectIds);
  if (
    projectIds.length !== incoming.size ||
    existing.size !== incoming.size ||
    projectIds.some((id) => !existing.has(id))
  ) {
    throw new ApiError(
      "Project order must include every project in the workspace exactly once.",
      400,
    );
  }

  const now = new Date();
  await database.transaction(async (tx) => {
    for (const [index, projectId] of projectIds.entries()) {
      await tx
        .update(projects)
        .set({ position: index, updatedAt: now })
        .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)));
    }
  });

  return fetchProjectSummaries(database, ownerId);
}

export async function archiveProject(
  projectId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<ProjectSummary> {
  await requireProject(database, projectId, ownerId);
  await database
    .update(projects)
    .set({ archived: true, archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)));
  const summary = await fetchProjectSummary(database, projectId, ownerId);
  if (!summary) throw new ApiError("Project not found.", 404);
  return summary;
}

export async function restoreProject(
  projectId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<ProjectSummary> {
  await requireProject(database, projectId, ownerId);
  await database
    .update(projects)
    .set({ archived: false, archivedAt: null, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)));
  const summary = await fetchProjectSummary(database, projectId, ownerId);
  if (!summary) throw new ApiError("Project not found.", 404);
  return summary;
}

export async function getProjectDetail(
  projectId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<ProjectDetail> {
  await requireProject(database, projectId, ownerId);
  const summary = await fetchProjectSummary(database, projectId, ownerId);
  if (!summary) throw new ApiError("Project not found.", 404);
  const allBoards = await fetchBoardSummaries(database, ownerId);
  return {
    project: summary,
    boards: allBoards.filter((board) => board.projectId === projectId),
  };
}

export async function getProjectDeletionSummary(
  projectId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<{ boardCount: number }> {
  const summary = await fetchProjectSummary(database, projectId, ownerId);
  if (!summary) throw new ApiError("Project not found.", 404);
  return { boardCount: summary.boardCount };
}

/**
 * Permanent deletion. Children are deleted explicitly, child-first, inside one
 * transaction so the SQLite delete triggers queue a tombstone for every row —
 * relying on FK cascade would skip the row triggers and leave orphaned cloud
 * data after the next sync. The caller has already confirmed the destructive
 * action via the "DELETE" phrase.
 */
export async function deleteProject(
  projectId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<void> {
  await requireProject(database, projectId, ownerId);

  const projectBoards = await database
    .select({ id: boards.id })
    .from(boards)
    .where(and(eq(boards.projectId, projectId), eq(boards.ownerId, ownerId)));
  const boardIds = projectBoards.map((row) => row.id);

  await database.transaction(async (tx) => {
    for (const boardId of boardIds) {
      // tasks cascade-delete subtasks/comments/task_labels via their own
      // triggers only if deleted as rows; delete the leaf tables first.
      const boardTasks = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.boardId, boardId));
      for (const task of boardTasks) {
        await tx.delete(tasks).where(eq(tasks.id, task.id));
      }
      await tx.delete(columns).where(eq(columns.boardId, boardId));
      await tx.delete(labels).where(eq(labels.boardId, boardId));
      await tx.delete(whiteboards).where(eq(whiteboards.boardId, boardId));
      await tx.delete(boards).where(eq(boards.id, boardId));
    }
    await tx
      .delete(projects)
      .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)));
  });
}
