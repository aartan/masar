import * as React from "react";

import { api, errorMessage } from "@/lib/client-api";
import { isWellFormedNoteDocument, parseNoteDocument } from "@/lib/note-document";
import {
  apiNoteImageCacheReader,
  hydrateNoteImages,
} from "@/lib/note-image-hydration";
import {
  forgetPendingDocument,
  takePendingDocument,
} from "@/lib/note-pending-document";
import type { NoteDocument } from "@/lib/types";

/**
 * Loads a note's persisted document for the editor.
 *
 * The loader prefers unsaved work from a previous mount (the user navigated
 * away while a save was still in flight, so the persisted document can lag
 * behind the editor). Malformed persisted documents are never handed to the
 * editor: an editor initialised from them would save an empty note over the
 * damaged content, silently destroying whatever could still be recovered.
 */

export type NoteDocumentState =
  | { status: "loading" }
  | {
      status: "ready";
      /** The board this document was loaded for (guards stale loads). */
      boardId: string;
      /**
       * The document as the editor should render it: image URLs resolved to
       * the local cache where a cached copy exists.
       */
      hydratedDocument: string;
      /** The persisted document as stored (canonical image URLs). */
      persistedDocument: string;
      /** The persisted row's `updatedAt`, when the API reported one. */
      updatedAt: string | null;
      /**
       * The raw unsaved document adopted from a previous mount, when one
       * existed and differed from the persisted document. The caller queues
       * it for saving so the interrupted save reaches the database.
       */
      adoptedPending: string | null;
    }
  | { status: "malformed"; raw: string }
  | { status: "error"; message: string };

export interface NoteDocumentLoad {
  state: NoteDocumentState;
  /** Reload the persisted document (also used for error retries). */
  retry(): void;
}

const EMPTY_DOCUMENT = "[]";

export function useNoteDocument(boardId: string): NoteDocumentLoad {
  const [state, setState] = React.useState<NoteDocumentState>({
    status: "loading",
  });
  const [attempt, setAttempt] = React.useState(0);
  const [loadedBoardId, setLoadedBoardId] = React.useState(boardId);

  // Reset synchronously during render when the board changes so no render
  // can observe a document that belongs to a different board.
  if (loadedBoardId !== boardId) {
    setLoadedBoardId(boardId);
    setState({ status: "loading" });
  }

  const retry = React.useCallback(() => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  React.useEffect(() => {
    let active = true;
    void api<{ document: NoteDocument }>(`/api/boards/${boardId}/document`)
      .then(async (result) => {
        if (!active) return;
        const raw = result.document.document || EMPTY_DOCUMENT;
        const updatedAt = result.document.updatedAt ?? null;

        // Prefer unsaved work from a previous mount. A pending document that
        // itself cannot be parsed is discarded: it cannot have come from the
        // editor in that state, and the persisted document is the safer base.
        const pending = takePendingDocument(boardId, raw);
        const usablePending =
          pending !== null &&
          pending !== raw &&
          parseNoteDocument(pending) !== null
            ? pending
            : null;
        if (pending !== null && usablePending === null) {
          // A pending document that cannot be parsed can never have come from
          // the editor; drop it so it does not shadow future loads.
          forgetPendingDocument(boardId);
        }

        if (usablePending === null && !isWellFormedNoteDocument(raw)) {
          setState({ status: "malformed", raw });
          return;
        }

        const source = usablePending ?? raw;
        const hydrated = await hydrateNoteImages(
          boardId,
          source,
          apiNoteImageCacheReader,
        );
        if (!active) return;
        setState({
          status: "ready",
          boardId,
          hydratedDocument: hydrated.document,
          persistedDocument: raw,
          updatedAt,
          adoptedPending: usablePending,
        });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ status: "error", message: errorMessage(error) });
        }
      });
    return () => {
      active = false;
    };
  }, [boardId, attempt]);

  return { state, retry };
}
