import { eq, notInArray } from "drizzle-orm";

import type { AppDatabase } from "@/db";
import { notes, taskImages, tasks, whiteboards } from "@/db/schema";
import { collectNoteImageIds } from "@/lib/note-document";
import { taskImageUrlId } from "@/lib/task-image";
import { sceneImageIds } from "./images";

/**
 * Find which candidate image ids are still referenced outside the excluded
 * boards.
 *
 * Note images (and task attachments) can be duplicated between boards while
 * sharing the same R2 object. Cleanup must never delete an object that a
 * surviving document, scene or task still points at. Callers pass the boards
 * whose content is being replaced or deleted.
 */
export async function imageIdsReferencedElsewhere(
  database: AppDatabase,
  imageIds: Iterable<string>,
  excludeBoardIds: Iterable<string> = [],
): Promise<Set<string>> {
  const wanted = new Set(imageIds);
  const referenced = new Set<string>();
  if (wanted.size === 0) return referenced;

  try {
    const exclusions = [...excludeBoardIds];
    const noteQuery = database
      .select({ document: notes.document })
      .from(notes);
    const sceneQuery = database
      .select({ scene: whiteboards.scene })
      .from(whiteboards);
    const taskQuery = database
      .select({ url: taskImages.url })
      .from(taskImages)
      .innerJoin(tasks, eq(taskImages.taskId, tasks.id));

    const [noteRows, sceneRows, taskRows] = await Promise.all([
      exclusions.length
        ? noteQuery.where(notInArray(notes.boardId, exclusions))
        : noteQuery,
      exclusions.length
        ? sceneQuery.where(notInArray(whiteboards.boardId, exclusions))
        : sceneQuery,
      exclusions.length
        ? taskQuery.where(notInArray(tasks.boardId, exclusions))
        : taskQuery,
    ]);

    for (const row of noteRows) {
      for (const imageId of collectNoteImageIds(row.document)) {
        if (wanted.has(imageId)) referenced.add(imageId);
      }
    }
    for (const row of sceneRows) {
      for (const imageId of sceneImageIds(row.scene)) {
        if (wanted.has(imageId)) referenced.add(imageId);
      }
    }
    for (const row of taskRows) {
      const imageId = taskImageUrlId(row.url);
      if (imageId && wanted.has(imageId)) referenced.add(imageId);
    }

    return referenced;
  } catch (error) {
    // Cleanup must never delete an object we could not prove unreferenced.
    // Treat every candidate as shared when the reference check fails.
    console.warn(
      "[masar] could not check shared image references; keeping images",
      error,
    );
    return new Set(wanted);
  }
}
