import { randomUUID } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import { subtasks } from "@/db/schema";
import { ApiError } from "@/lib/api";
import type { Subtask } from "@/lib/types";
import type { SubtaskUpdateInput } from "@/lib/validation";
import { requireSubtask, requireTask } from "./queries";
import { serializeSubtask } from "./tasks";

export async function createSubtask(
  taskId: string,
  title: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<Subtask> {
  await requireTask(database, taskId, ownerId);
  const [row] = await database
    .select({ value: sql<number>`coalesce(max(${subtasks.position}), -1)` })
    .from(subtasks)
    .where(eq(subtasks.taskId, taskId));
  const id = randomUUID();
  const now = new Date();
  await database.insert(subtasks).values({
    id,
    taskId,
    title,
    completed: false,
    position: (row?.value ?? -1) + 1,
    createdAt: now,
  });
  return serializeSubtask({
    id,
    taskId,
    title,
    completed: false,
    position: (row?.value ?? -1) + 1,
    createdAt: now,
  });
}

export async function updateSubtask(
  subtaskId: string,
  input: SubtaskUpdateInput,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<Subtask> {
  await requireSubtask(database, subtaskId, ownerId);

  await database
    .update(subtasks)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.completed !== undefined ? { completed: input.completed } : {}),
    })
    .where(eq(subtasks.id, subtaskId));

  const [row] = await database
    .select()
    .from(subtasks)
    .where(eq(subtasks.id, subtaskId))
    .limit(1);
  if (!row) throw new ApiError("Subtask not found.", 404);
  return serializeSubtask(row);
}

export async function deleteSubtask(
  subtaskId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<void> {
  await requireSubtask(database, subtaskId, ownerId);
  await database.delete(subtasks).where(eq(subtasks.id, subtaskId));
}

export async function listSubtasks(
  taskId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<Subtask[]> {
  await requireTask(database, taskId, ownerId);
  const rows = await database
    .select()
    .from(subtasks)
    .where(eq(subtasks.taskId, taskId))
    .orderBy(asc(subtasks.position));
  return rows.map(serializeSubtask);
}

export async function countSubtasks(
  taskId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<{ total: number; done: number }> {
  await requireTask(database, taskId, ownerId);
  const [row] = await database
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      done: sql<number>`sum(case when ${subtasks.completed} = 1 then 1 else 0 end)`.mapWith(
        Number,
      ),
    })
    .from(subtasks)
    .where(and(eq(subtasks.taskId, taskId)));
  return { total: row?.total ?? 0, done: row?.done ?? 0 };
}
