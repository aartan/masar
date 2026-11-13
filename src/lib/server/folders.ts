import { randomUUID } from "node:crypto";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import { boards, folders } from "@/db/schema";
import { ApiError } from "@/lib/api";
import type { FolderSummary } from "@/lib/types";
import type {
  FolderCreateInput,
  FolderUpdateInput,
  MoveFolderInput,
} from "@/lib/validation";
import {
  assertProjectWritable,
  fetchFolderSummaries,
  nextFolderPosition,
  requireFolder,
  requireProject,
} from "./queries";

export async function listFolders(
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<FolderSummary[]> {
  return fetchFolderSummaries(database, ownerId);
}

/**
 * Resolve a folder and its project, enforcing ownership and archive state.
 * Folder mutations always go through the owning project so archived projects
 * stay read-only.
 */
async function folderWithWritableProject(
  database: AppDatabase,
  folderId: string,
  ownerId: string,
) {
  const folder = await requireFolder(database, folderId, ownerId);
  const project = await requireProject(database, folder.projectId, ownerId);
  assertProjectWritable(project);
  return { folder, project };
}

/** Verify a folder belongs to a specific project before assigning a space. */
export async function requireFolderInProject(
  database: AppDatabase,
  folderId: string,
  projectId: string,
  ownerId: string,
) {
  const folder = await requireFolder(database, folderId, ownerId);
  if (folder.projectId !== projectId) {
    throw new ApiError("That folder belongs to another project.", 400);
  }
  return folder;
}

/**
 * Reject moving a folder into itself or any of its descendants. The ancestor
 * walk is iterative so there is no recursion/depth limit.
 */
async function assertValidFolderParent(
  database: AppDatabase,
  folderId: string,
  parentId: string | null,
  projectId: string,
  ownerId: string,
) {
  if (!parentId) return null;
  if (parentId === folderId) {
    throw new ApiError("A folder cannot be moved inside itself.", 400);
  }

  const parent = await requireFolder(database, parentId, ownerId);
  if (parent.projectId !== projectId) {
    throw new ApiError("Folders cannot be moved between projects.", 400);
  }

  const seen = new Set<string>();
  let cursor: typeof parent | null = parent;
  while (cursor) {
    if (cursor.id === folderId) {
      throw new ApiError(
        "A folder cannot be moved inside one of its own subfolders.",
        400,
      );
    }
    if (!cursor.parentId) break;
    if (seen.has(cursor.id)) break;
    seen.add(cursor.id);
    cursor = await requireFolder(database, cursor.parentId, ownerId);
    if (cursor.projectId !== projectId) {
      throw new ApiError("Folders cannot be moved between projects.", 400);
    }
  }
  return parent;
}

export async function createFolder(
  input: FolderCreateInput,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<FolderSummary> {
  const project = await requireProject(database, input.projectId, ownerId);
  assertProjectWritable(project);

  const parentId = input.parentId ?? null;
  if (parentId) {
    await requireFolderInProject(database, parentId, project.id, ownerId);
  }

  const position = await nextFolderPosition(database, project.id, parentId);
  const id = randomUUID();
  const now = new Date();
  await database.insert(folders).values({
    id,
    ownerId,
    projectId: project.id,
    parentId,
    name: input.name,
    position,
    createdAt: now,
    updatedAt: now,
  });

  const summary = (await fetchFolderSummaries(database, ownerId, project.id)).find(
    (folder) => folder.id === id,
  );
  if (!summary) throw new ApiError("Folder could not be created.", 500);
  return summary;
}

export async function updateFolder(
  folderId: string,
  input: FolderUpdateInput,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<FolderSummary> {
  const { folder } = await folderWithWritableProject(
    database,
    folderId,
    ownerId,
  );
  await database
    .update(folders)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(folders.id, folder.id), eq(folders.ownerId, ownerId)));

  const summary = (await fetchFolderSummaries(database, ownerId, folder.projectId)).find(
    (row) => row.id === folder.id,
  );
  if (!summary) throw new ApiError("Folder not found.", 404);
  return summary;
}

/**
 * Move a folder to a new parent (null = project root) and insert it at `index`
 * among its new siblings. The folder's descendants are untouched, so the whole
 * subtree moves with it.
 */
export async function moveFolder(
  folderId: string,
  input: MoveFolderInput,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<FolderSummary[]> {
  const { folder } = await folderWithWritableProject(
    database,
    folderId,
    ownerId,
  );
  const parentId = input.parentId ?? null;
  await assertValidFolderParent(
    database,
    folder.id,
    parentId,
    folder.projectId,
    ownerId,
  );

  const now = new Date();
  await database.transaction(async (tx) => {
    const sourceParentId = folder.parentId;
    const sourceSiblings = (
      await tx
        .select({ id: folders.id })
        .from(folders)
        .where(
          and(
            eq(folders.projectId, folder.projectId),
            sourceParentId
              ? eq(folders.parentId, sourceParentId)
              : isNull(folders.parentId),
          ),
        )
        .orderBy(asc(folders.position), asc(folders.createdAt))
    )
      .map((row) => row.id)
      .filter((id) => id !== folder.id);

    const destinationSiblings =
      sourceParentId === parentId
        ? sourceSiblings
        : (
            await tx
              .select({ id: folders.id })
              .from(folders)
              .where(
                and(
                  eq(folders.projectId, folder.projectId),
                  parentId
                    ? eq(folders.parentId, parentId)
                    : isNull(folders.parentId),
                ),
              )
              .orderBy(asc(folders.position), asc(folders.createdAt))
          ).map((row) => row.id);

    const next = [...destinationSiblings];
    next.splice(Math.min(Math.max(input.index, 0), next.length), 0, folder.id);

    if (sourceParentId !== parentId) {
      for (const [index, id] of sourceSiblings.entries()) {
        await tx
          .update(folders)
          .set({ position: index, updatedAt: now })
          .where(and(eq(folders.id, id), eq(folders.ownerId, ownerId)));
      }
    }

    for (const [index, id] of next.entries()) {
      await tx
        .update(folders)
        .set({
          parentId,
          position: index,
          ...(id === folder.id ? { updatedAt: now } : {}),
        })
        .where(and(eq(folders.id, id), eq(folders.ownerId, ownerId)));
    }
  });

  return fetchFolderSummaries(database, ownerId);
}

/** Position of the next direct child folder in the target container. */
async function nextPositionInTransaction(
  tx: Parameters<Parameters<AppDatabase["transaction"]>[0]>[0],
  projectId: string,
  parentId: string | null,
): Promise<number> {
  const [row] = await tx
    .select({ value: sql<number>`coalesce(max(${folders.position}), -1)` })
    .from(folders)
    .where(
      and(
        eq(folders.projectId, projectId),
        parentId ? eq(folders.parentId, parentId) : isNull(folders.parentId),
      ),
    );
  return Number(row?.value ?? -1) + 1;
}

async function nextBoardPositionInTransaction(
  tx: Parameters<Parameters<AppDatabase["transaction"]>[0]>[0],
  projectId: string,
  folderId: string | null,
): Promise<number> {
  const [row] = await tx
    .select({ value: sql<number>`coalesce(max(${boards.position}), -1)` })
    .from(boards)
    .where(
      and(
        eq(boards.projectId, projectId),
        folderId ? eq(boards.folderId, folderId) : isNull(boards.folderId),
      ),
    );
  return Number(row?.value ?? -1) + 1;
}

/** Compact sibling folder positions after a promotion or removal. */
async function reindexContainerFolders(
  tx: Parameters<Parameters<AppDatabase["transaction"]>[0]>[0],
  projectId: string,
  parentId: string | null,
  ownerId: string,
  now: Date,
): Promise<void> {
  const rows = await tx
    .select({ id: folders.id, position: folders.position })
    .from(folders)
    .where(
      and(
        eq(folders.projectId, projectId),
        parentId ? eq(folders.parentId, parentId) : isNull(folders.parentId),
      ),
    )
    .orderBy(asc(folders.position), asc(folders.createdAt));
  for (const [index, row] of rows.entries()) {
    if (row.position === index) continue;
    await tx
      .update(folders)
      .set({ position: index, updatedAt: now })
      .where(and(eq(folders.id, row.id), eq(folders.ownerId, ownerId)));
  }
}

/** Compact sibling space positions after a promotion or removal. */
async function reindexContainerBoards(
  tx: Parameters<Parameters<AppDatabase["transaction"]>[0]>[0],
  projectId: string,
  folderId: string | null,
  ownerId: string,
  now: Date,
): Promise<void> {
  const rows = await tx
    .select({ id: boards.id, position: boards.position })
    .from(boards)
    .where(
      and(
        eq(boards.projectId, projectId),
        folderId ? eq(boards.folderId, folderId) : isNull(boards.folderId),
      ),
    )
    .orderBy(asc(boards.position), asc(boards.createdAt));
  for (const [index, row] of rows.entries()) {
    if (row.position === index) continue;
    await tx
      .update(boards)
      .set({ position: index, updatedAt: now })
      .where(and(eq(boards.id, row.id), eq(boards.ownerId, ownerId)));
  }
}

/**
 * Delete a folder while preserving its contents. Direct child folders and
 * spaces are promoted to the deleted folder's parent (project root for a
 * top-level folder). Explicit row updates ensure every promoted child queues a
 * sync change; relying on the FK cascade would not.
 */
export async function deleteFolder(
  folderId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<void> {
  const { folder } = await folderWithWritableProject(
    database,
    folderId,
    ownerId,
  );
  const parentId = folder.parentId;
  const now = new Date();

  await database.transaction(async (tx) => {
    const [childFolders, childBoards] = await Promise.all([
      tx
        .select({ id: folders.id })
        .from(folders)
        .where(
          and(
            eq(folders.projectId, folder.projectId),
            eq(folders.parentId, folder.id),
          ),
        )
        .orderBy(asc(folders.position), asc(folders.createdAt)),
      tx
        .select({ id: boards.id })
        .from(boards)
        .where(
          and(
            eq(boards.projectId, folder.projectId),
            eq(boards.folderId, folder.id),
          ),
        )
        .orderBy(asc(boards.position), asc(boards.createdAt)),
    ]);

    // Remove the folder first so promotion starts at the end of the destination
    // container's remaining siblings, not after the doomed folder's own slot.
    await tx
      .delete(folders)
      .where(and(eq(folders.id, folder.id), eq(folders.ownerId, ownerId)));

    let folderPosition = await nextPositionInTransaction(
      tx,
      folder.projectId,
      parentId,
    );
    for (const child of childFolders) {
      await tx
        .update(folders)
        .set({ parentId, position: folderPosition, updatedAt: now })
        .where(and(eq(folders.id, child.id), eq(folders.ownerId, ownerId)));
      folderPosition += 1;
    }

    let boardPosition = await nextBoardPositionInTransaction(
      tx,
      folder.projectId,
      parentId,
    );
    for (const child of childBoards) {
      await tx
        .update(boards)
        .set({ folderId: parentId, position: boardPosition, updatedAt: now })
        .where(and(eq(boards.id, child.id), eq(boards.ownerId, ownerId)));
      boardPosition += 1;
    }

    // Promotions land at the end of the destination; compact both sibling
    // lists so positions stay contiguous for drag-and-drop ordering.
    await reindexContainerFolders(tx, folder.projectId, parentId, ownerId, now);
    await reindexContainerBoards(tx, folder.projectId, parentId, ownerId, now);
  });
}
