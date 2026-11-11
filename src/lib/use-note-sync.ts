import * as React from "react";

import type { BlockNoteEditor, PartialBlock } from "@blocknote/core";

import { api } from "@/lib/client-api";
import { parseNoteDocument } from "@/lib/note-document";
import {
  apiNoteImageCacheReader,
  hydrateNoteImages,
} from "@/lib/note-image-hydration";
import { shouldApplyRemoteDocument } from "@/lib/note-sync-guards";
import type { NoteAutosave } from "@/lib/use-note-autosave";
import { useOnSyncComplete } from "@/lib/use-sync-refresh";
import type { NoteDocument } from "@/lib/types";

/**
 * Applies remote document updates after a desktop sync cycle finishes.
 *
 * A remote update is only applied while the editor has no pending or
 * in-flight local edits, so local work is never replaced (see
 * {@link shouldApplyRemoteDocument}). Stale responses are discarded through
 * a generation counter, and the applied document is marked as a remote echo
 * so the autosave never mistakes it for a user edit.
 */

export function useNoteSync({
  boardId,
  editor,
  autosave,
}: {
  boardId: string;
  editor: BlockNoteEditor | null;
  autosave: NoteAutosave;
}) {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Latest board id, so stale responses never apply to a newer board. */
  const boardIdRef = React.useRef(boardId);
  boardIdRef.current = boardId;

  /** Discards responses from sync refreshes superseded by a newer one. */
  const generationRef = React.useRef(0);

  const refreshFromSync = React.useCallback(async () => {
    if (!editor) return;
    const loop = autosave.loop();
    if (!loop || loop.pendingDocument !== null || loop.saving) return;

    const generation = ++generationRef.current;
    try {
      const result = await api<{ document: NoteDocument }>(
        `/api/boards/${boardId}/document`,
      );
      if (
        generation !== generationRef.current ||
        !mountedRef.current ||
        boardIdRef.current !== boardId
      ) {
        return;
      }

      const remote = result.document.document || "[]";
      const remoteUpdatedAt = result.document.updatedAt ?? null;
      if (
        !shouldApplyRemoteDocument({
          pendingDocument: loop.pendingDocument,
          saving: loop.saving,
          remote,
          lastSavedDocument: loop.lastSavedDocument,
          boardId,
          remoteUpdatedAt,
          savedUpdatedAt: loop.savedUpdatedAt,
        })
      ) {
        return;
      }

      const hydrated = await hydrateNoteImages(
        boardId,
        remote,
        apiNoteImageCacheReader,
      );
      // A local edit may have started while the document was loading, or the
      // board changed underneath the refresh.
      if (
        generation !== generationRef.current ||
        !mountedRef.current ||
        boardIdRef.current !== boardId ||
        loop.pendingDocument !== null ||
        loop.saving
      ) {
        return;
      }

      autosave.setSavedDocument(remote, remoteUpdatedAt);
      editor.replaceBlocks(
        editor.document,
        (parseNoteDocument(hydrated.document) ??
          []) as unknown as PartialBlock[],
      );
      // Mark the applied document as a remote echo so the change event it
      // produces is never treated as a user edit, and confirm the fresh
      // state to the save indicator.
      autosave.beginRemoteApplication(JSON.stringify(editor.document));
      autosave.markSaved();
    } catch {
      /* Keep the current document if a background refresh fails. */
    }
  }, [autosave, boardId, editor]);

  useOnSyncComplete(() => {
    void refreshFromSync();
  });
}
