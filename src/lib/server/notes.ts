import { and, eq } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import { boards, notes } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { collectNoteImageIds } from "@/lib/note-document";
import type { NoteDocument } from "@/lib/types";
import { assertBoardWritable } from "./queries";
import { pruneBoardCache } from "./image-cache";
import { validateNoteEmbeddedImages } from "./image-data";
import { imageIdsReferencedElsewhere } from "./image-references";
import {
  premiumImageClient,
  removeSceneImages,
  type SceneImageStorage,
} from "./images";

/**
 * Maximum serialized BlockNote document size. Premium notes store only image
 * URL references, so this cap is generous; the free local workspace keeps
 * embedded data-URL images under the same limit. This mirrors the whiteboard
 * scene cap so a sync cycle can never push an oversized entity.
 */
export const MAX_NOTE_BYTES = 2 * 1024 * 1024;

/** Resolve a note board owned by the caller, or throw 404. */
export async function requireNoteBoard(
  database: AppDatabase,
  boardId: string,
  ownerId: string,
) {
  const [row] = await database
    .select({ board: boards })
    .from(boards)
    .where(and(eq(boards.id, boardId), eq(boards.ownerId, ownerId)))
    .limit(1);
  if (!row) throw new ApiError("Space not found.", 404);
  if (row.board.type !== "note") {
    throw new ApiError("This space is not a note.", 400);
  }
  return row.board;
}

export async function getNoteDocument(
  boardId: string,
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<NoteDocument> {
  await requireNoteBoard(database, boardId, ownerId);
  const [row] = await database
    .select()
    .from(notes)
    .where(eq(notes.boardId, boardId))
    .limit(1);

  // A note row is created with the board, but be defensive: a board that
  // predates its document row reads as an empty document.
  if (!row) {
    return { boardId, document: "[]", updatedAt: new Date(0).toISOString() };
  }
  return {
    boardId: row.boardId,
    document: row.document,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function saveNoteDocument(
  boardId: string,
  document: string,
  ownerId: string,
  database: AppDatabase = getDb(),
  images: SceneImageStorage | null = premiumImageClient(),
): Promise<NoteDocument> {
  await requireNoteBoard(database, boardId, ownerId);
  // Rejects mutations while the owning project is archived.
  await assertBoardWritable(database, boardId, ownerId);
  validateNoteEmbeddedImages(document);

  const size = Buffer.byteLength(document, "utf8");
  if (size > MAX_NOTE_BYTES) {
    throw new ApiError(
      "This note is too large to save. Reduce the number or size of images.",
      413,
    );
  }

  const [existing] = await database
    .select({ document: notes.document })
    .from(notes)
    .where(eq(notes.boardId, boardId))
    .limit(1);

  const now = new Date();
  await database
    .insert(notes)
    .values({ boardId, document, updatedAt: now })
    .onConflictDoUpdate({
      target: notes.boardId,
      set: { document, updatedAt: now },
    });

  // Cache rows for images that no longer exist in the document are stale.
  const nextImageIds = new Set(collectNoteImageIds(document));
  await pruneBoardCache(boardId, nextImageIds, database);

  // Image objects live in R2, outside SQLite. Remove the ones this document
  // dropped, matching the whiteboard save's reconciliation.
  const previousImageIds = new Set(
    collectNoteImageIds(existing?.document),
  );
  const candidates = [...previousImageIds].filter(
    (imageId) => !nextImageIds.has(imageId),
  );
  if (candidates.length > 0) {
    // Images can be copied between notes. Keep the object while any other
    // document, scene or task still references it.
    const shared = await imageIdsReferencedElsewhere(
      database,
      candidates,
      [boardId],
    );
    await removeSceneImages(
      images,
      candidates.filter((imageId) => !shared.has(imageId)),
    );
  }

  // Do not touch the board row here. It used to refresh boards.updated_at for
  // activity, but activity reads the content rows' updated_at directly and an
  // extra board write would queue a board sync change on every autosave — the
  // same race the whiteboard save deliberately avoids.

  return { boardId, document, updatedAt: now.toISOString() };
}
