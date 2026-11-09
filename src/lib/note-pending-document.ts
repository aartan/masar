/**
 * In-memory registry of the newest unsaved note document per board.
 *
 * Navigating away from a note unmounts its component, and with it the save
 * loop that held the latest serialized state. When a document save is still
 * in flight, the persisted document may lag behind the editor. The registry
 * hands the unsaved document to the next mount of the same board so no work
 * disappears just because the user switched spaces — the same handoff the
 * whiteboard pending-scene registry provides.
 *
 * Entries are cleared when a save confirms the document (see the save loop's
 * `saved` status) or when the editor returns to the persisted state.
 */

const pendingDocuments = new Map<string, string>();

/** Remember the board's current unsaved state. */
export function rememberPendingDocument(boardId: string, document: string): void {
  pendingDocuments.set(boardId, document);
}

/** Drop the board's unsaved state (it has been persisted). */
export function forgetPendingDocument(boardId: string): void {
  pendingDocuments.delete(boardId);
}

/**
 * The unsaved document for a board, or null when none exists or it already
 * matches the persisted document. A stale entry is cleared before returning.
 */
export function takePendingDocument(
  boardId: string,
  persistedDocument: string,
): string | null {
  const pending = pendingDocuments.get(boardId);
  if (pending === undefined) return null;
  if (pending === persistedDocument) {
    pendingDocuments.delete(boardId);
    return null;
  }
  return pending;
}

/** For tests: whether any unsaved documents are currently registered. */
export function pendingDocumentCount(): number {
  return pendingDocuments.size;
}

/** For tests: reset the registry between cases. */
export function resetPendingDocuments(): void {
  pendingDocuments.clear();
}
