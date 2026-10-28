import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import { comments } from "@/db/schema";
import type { Comment } from "@/lib/types";
import { requireComment, requireTask } from "./queries";
import { serializeComment } from "./tasks";

export async function createComment(
  taskId: string,
  input: { body: string; author?: string },
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<Comment> {
  await requireTask(database, taskId, ownerId);
  const id = randomUUID();
  const now = new Date();
  const author = input.author?.trim() || "You";
  await database.insert(comments).values({
    id,
    taskId,
    author,
    body: input.body,
    createdAt: now,
  });
  return serializeComment({
    id,
    taskId,
    author,
    body: input.body,
    createdAt: now,
  });
}

export async function listComments(
  taskId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<Comment[]> {
  await requireTask(database, taskId, ownerId);
  const rows = await database
    .select()
    .from(comments)
    .where(eq(comments.taskId, taskId))
    .orderBy(asc(comments.createdAt));
  return rows.map(serializeComment);
}

export async function deleteComment(
  commentId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<void> {
  await requireComment(database, commentId, ownerId);
  await database.delete(comments).where(eq(comments.id, commentId));
}
