import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import { labels } from "@/db/schema";
import { ApiError } from "@/lib/api";
import type { Label } from "@/lib/types";
import type { LabelCreateInput, LabelUpdateInput } from "@/lib/validation";
import {
  isUniqueConstraintError,
  requireBoard,
  requireLabel,
  serializeLabel,
} from "./queries";

export async function createLabel(
  boardId: string,
  input: LabelCreateInput,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<Label> {
  await requireBoard(database, boardId, ownerId);
  const id = randomUUID();
  const now = new Date();

  try {
    await database.insert(labels).values({
      id,
      boardId,
      name: input.name,
      color: input.color ?? "slate",
      createdAt: now,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ApiError("A label with that name already exists.", 409);
    }
    throw error;
  }

  const [row] = await database
    .select()
    .from(labels)
    .where(eq(labels.id, id))
    .limit(1);
  if (!row) throw new ApiError("Label could not be created.", 500);
  return serializeLabel(row);
}

export async function updateLabel(
  labelId: string,
  input: LabelUpdateInput,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<Label> {
  await requireLabel(database, labelId, ownerId);

  try {
    await database
      .update(labels)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
      })
      .where(eq(labels.id, labelId));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ApiError("A label with that name already exists.", 409);
    }
    throw error;
  }

  const [row] = await database
    .select()
    .from(labels)
    .where(eq(labels.id, labelId))
    .limit(1);
  if (!row) throw new ApiError("Label not found.", 404);
  return serializeLabel(row);
}

export async function deleteLabel(
  labelId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<void> {
  await requireLabel(database, labelId, ownerId);
  await database.delete(labels).where(eq(labels.id, labelId));
}
