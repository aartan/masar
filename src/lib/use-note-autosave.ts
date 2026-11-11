import * as React from "react";

import type { BlockNoteEditor } from "@blocknote/core";

import { api } from "@/lib/client-api";
import {
  canonicalizeNoteDocument,
  noteDocumentsEquivalent,
} from "@/lib/note-document";
import {
  forgetPendingDocument,
  rememberPendingDocument,
} from "@/lib/note-pending-document";
import { NoteSaveLoop, type NoteSaveStatus } from "@/lib/note-save-loop";
import type { NoteDocument } from "@/lib/types";

const SAVE_DEBOUNCE_MS = 1_200;

/**
 * Owns dirty-state tracking and save serialization for one note.
 *
 * A fresh {@link NoteSaveLoop} is created whenever the board changes, with
 * the board id captured inside the loop: an asynchronous save can therefore
 * never be written to a different board than the one it was queued for, and
 * a loop abandoned by a board switch stops emitting status immediately while
 * still letting an in-flight save finish persisting its queued work.
 *
 * Remote document applications are distinguished from user edits by content:
 * {@link beginRemoteApplication} records the exact serialized document the
 * editor will echo back after `replaceBlocks`; the first identical change is
 * treated as the remote echo and does not trigger a save. Any differing
 * change is a user edit. No timers are involved.
 */

export interface NoteAutosave {
  /** Current save status, for the header indicator. */
  status: NoteSaveStatus;
  /** Timestamp of the last successful save, or null. */
  lastSavedAt: number | null;
  /**
   * Adopt a persisted document without saving it (initial load, sync
   * refresh). No-op while the loop for `boardId` is not constructed yet or
   * was abandoned.
   */
  setSavedDocument(document: string, updatedAt?: string | null): void;
  /**
   * Record the editor's current state. Identical echoes of a remote
   * application are ignored; everything else is debounced into the save
   * loop and mirrored into the pending-document registry.
   */
  handleEditorChange(editor: BlockNoteEditor): void;
  /** Mark that the next identical editor change is a remote echo. */
  beginRemoteApplication(serialized: string): void;
  /**
   * Queue an exact serialized document for saving immediately (used to
   * continue an interrupted save adopted from the pending registry).
   */
  adoptAndFlush(serialized: string): void;
  /**
   * Confirm that everything is persisted and show "Saved" — used after a
   * clean load or after a remote document application.
   */
  markSaved(): void;
  /** Retry persisting the queued document after an error. */
  retry(): void;
  /** The current save loop (for sync refresh guards). */
  loop(): NoteSaveLoop | null;
}

interface OwnedLoop {
  boardId: string;
  loop: NoteSaveLoop;
}

export function useNoteAutosave({
  boardId,
  readOnly,
}: {
  boardId: string;
  readOnly: boolean;
}): NoteAutosave {
  const [status, setStatus] = React.useState<NoteSaveStatus>({ phase: "idle" });
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);

  const ownedRef = React.useRef<OwnedLoop | null>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Exact serialized document of the pending remote echo, or null. */
  const markerRef = React.useRef<string | null>(null);
  const boardIdRef = React.useRef(boardId);
  boardIdRef.current = boardId;

  const persistNow = React.useCallback(
    (targetBoardId: string, serialized: string) => {
      void api(`/api/boards/${targetBoardId}/document`, {
        method: "PUT",
        body: JSON.stringify({
          document: canonicalizeNoteDocument(serialized, targetBoardId),
        }),
      }).catch(() => undefined);
    },
    [],
  );

  // Own one save loop per board. When the board changes, the cleanup hands
  // any unsaved work over to a fire-and-forget save for the previous board
  // and detaches the old loop (it stops emitting status but drains its
  // in-flight save silently); the new loop captures the new board id.
  React.useEffect(() => {
    const targetBoardId = boardId;
    setStatus({ phase: "idle" });
    setLastSavedAt(null);
    ownedRef.current = {
      boardId,
      loop: new NoteSaveLoop({
        boardId: targetBoardId,
        save: async (saveBoardId, serialized) => {
          const result = await api<{ document: NoteDocument }>(
            `/api/boards/${saveBoardId}/document`,
            {
              method: "PUT",
              body: JSON.stringify({
                document: canonicalizeNoteDocument(serialized, saveBoardId),
              }),
            },
          );
          return {
            document: result.document.document || "[]",
            updatedAt: result.document.updatedAt ?? null,
          };
        },
        onStatus: (next) => {
          setStatus(next);
          if (next.phase === "saved") {
            setLastSavedAt(next.at);
            // The persisted state now matches; drop the in-memory handoff.
            forgetPendingDocument(targetBoardId);
          }
        },
        isEquivalent: (a, b) =>
          noteDocumentsEquivalent(a, b, targetBoardId),
      }),
    };
    return () => {
      const owned = ownedRef.current;
      if (!owned || owned.boardId !== boardId) return;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      // Persist the newest unsaved document directly when the component (or
      // this board's loop) goes away and no save is in flight; an in-flight
      // drain persists its queue silently after dispose.
      const pending = owned.loop.pendingDocument;
      if (
        pending &&
        !owned.loop.isContentSaved(pending) &&
        !owned.loop.saving
      ) {
        persistNow(boardId, pending);
      }
      owned.loop.dispose();
      ownedRef.current = null;
    };
  }, [boardId, persistNow]);

  // Retry queued saves automatically when connectivity returns.
  React.useEffect(() => {
    const handleOnline = () => {
      const owned = ownedRef.current;
      if (!owned || owned.boardId !== boardId) return;
      if (owned.loop.pendingDocument !== null) owned.loop.flush();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [boardId]);

  const setSavedDocument = React.useCallback(
    (document: string, updatedAt?: string | null) => {
      const owned = ownedRef.current;
      if (!owned || owned.boardId !== boardId) return;
      owned.loop.setSavedDocument(document, updatedAt ?? null);
    },
    [boardId],
  );

  const handleEditorChange = React.useCallback(
    (instance: BlockNoteEditor) => {
      if (readOnly) return;
      const owned = ownedRef.current;
      if (!owned || owned.boardId !== boardId) return;
      const loop = owned.loop;

      const serialized = JSON.stringify(instance.document);

      // The first change after a remote application echoes the applied
      // document exactly; consume the marker and skip it. A differing change
      // is a user edit — consume the marker and treat it normally.
      if (markerRef.current !== null) {
        const marker = markerRef.current;
        markerRef.current = null;
        if (noteDocumentsEquivalent(serialized, marker, boardId)) return;
      }

      loop.change(serialized);
      if (loop.isContentSaved(serialized)) {
        forgetPendingDocument(boardId);
        if (!loop.saving) {
          // The document matches what is persisted (for example an edit was
          // undone back to the saved state). Normalize the indicator instead
          // of leaving it stuck at "Unsaved changes".
          setStatus((current) =>
            current.phase === "saved"
              ? current
              : { phase: "saved", at: Date.now() },
          );
        }
        return;
      }

      // Keep the unsaved state available for the next mount of this board.
      rememberPendingDocument(boardId, serialized);
      setStatus((current) =>
        current.phase === "unsaved" ? current : { phase: "unsaved" },
      );
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        const owned = ownedRef.current;
        if (owned && owned.boardId === boardId) owned.loop.flush();
      }, SAVE_DEBOUNCE_MS);
    },
    [boardId, readOnly],
  );

  const beginRemoteApplication = React.useCallback((serialized: string) => {
    markerRef.current = serialized;
  }, []);

  const adoptAndFlush = React.useCallback(
    (serialized: string) => {
      const owned = ownedRef.current;
      if (!owned || owned.boardId !== boardId) return;
      owned.loop.change(serialized);
      owned.loop.flush();
    },
    [boardId],
  );

  const markSaved = React.useCallback(() => {
    const at = Date.now();
    setStatus({ phase: "saved", at });
    setLastSavedAt(at);
  }, []);

  const retry = React.useCallback(() => {
    const owned = ownedRef.current;
    if (!owned || owned.boardId !== boardId) return;
    if (owned.loop.pendingDocument !== null) owned.loop.flush();
  }, [boardId]);

  const loop = React.useCallback((): NoteSaveLoop | null => {
    const owned = ownedRef.current;
    if (!owned || owned.boardId !== boardId) return null;
    return owned.loop;
  }, [boardId]);

  return {
    status,
    lastSavedAt,
    setSavedDocument,
    handleEditorChange,
    beginRemoteApplication,
    adoptAndFlush,
    markSaved,
    retry,
    loop,
  };
}
