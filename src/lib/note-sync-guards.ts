import { noteDocumentsEquivalent } from "@/lib/note-document";

/**
 * Pure decision logic for applying a remote document to the editor after a
 * sync cycle. Extracted so the guards stay testable without a running
 * editor.
 */

export interface RemoteDocumentDecision {
  /** The newest local document that still needs persisting. */
  pendingDocument: string | null;
  /** Whether a local save is in flight. */
  saving: boolean;
  /** The document fetched from the API. */
  remote: string;
  /** The document the save loop currently considers persisted. */
  lastSavedDocument: string;
  /** The board the decision is made for. */
  boardId: string;
  /** The remote row's `updatedAt`, when reported. */
  remoteUpdatedAt: string | null;
  /** The `updatedAt` of the document the loop currently tracks. */
  savedUpdatedAt: string | null;
}

/**
 * True when the fetched remote document should replace the editor content.
 *
 * Never replaces an editor with pending or in-flight local edits, skips
 * refreshes whose revision already matches what the loop tracks, and skips
 * documents that are content-equivalent to the persisted one (for example a
 * save we made ourselves that the sync cycle echoed back).
 */
export function shouldApplyRemoteDocument(input: RemoteDocumentDecision): boolean {
  if (input.pendingDocument !== null || input.saving) return false;
  if (
    input.remoteUpdatedAt !== null &&
    input.savedUpdatedAt === input.remoteUpdatedAt &&
    input.lastSavedDocument === input.remote
  ) {
    return false;
  }
  if (
    noteDocumentsEquivalent(
      input.remote,
      input.lastSavedDocument,
      input.boardId,
    )
  ) {
    return false;
  }
  return true;
}
