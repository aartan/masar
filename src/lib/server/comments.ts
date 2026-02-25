import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import { comments } from "@/db/schema";
import { ApiError } from "@/lib/api";
import type { Comment } from "@/lib/types";
import { requireTask } from "./queries";
import { serializeComment } from "./tasks";

export async function createComment(
  taskId: string,
  input: { body: string; author?: string },
  database: AppDatabase = getDb(),
): Promise<Comment> {
  await requireTask(database, taskId);
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
  database: AppDatabase = getDb(),
): Promise<Comment[]> {
  const rows = await database
    .select()
    .from(comments)
    .where(eq(comments.taskId, taskId))
    .orderBy(asc(comments.createdAt));
  return rows.map(serializeComment);
}

export async function deleteComment(
  commentId: string,
  database: AppDatabase = getDb(),
): Promise<void> {
  const [existing] = await database
    .select()
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!existing) throw new ApiError("Comment not found.", 404);
  await database.delete(comments).where(eq(comments.id, commentId));
}
