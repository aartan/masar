import { ClientApiError, errorMessage } from "@/lib/client-api";

/**
 * Serializes note document saves.
 *
 * Saving a note can be slower than a plain row update (large embedded images
 * in the free workspace), so saves must never overlap — the same contract as
 * the whiteboard save loop. The loop keeps at most one request in flight; the
 * newest document is always queued in `pending` and every completed save
 * immediately drains the queue again, so the last write always carries the
 * newest state and responses can never arrive out of order.
 *
 * Unlike the whiteboard loop, note content comparison is plain string
 * equality: BlockNote serializes its document deterministically and the
 * server stores the document verbatim (image URLs are resolved at insertion
 * time, not during the save).
 *
 * The loop is constructed for exactly one board: `boardId` is captured at
 * construction and passed to every `save` call, so a save that was queued for
 * one board can never be written to a different board — even when the board
 * prop swaps underneath the component that owns the loop.
 *
 * `dispose()` detaches the loop from its observers (no further status
 * emissions, no further flushes) while letting a save already in flight
 * finish persisting its queued work silently. This keeps unmount- and
 * board-switch handoffs from losing the newest document, and prevents a stale
 * loop from updating the status or document state of a newer loop.
 */

export type NoteSaveStatus =
  | { phase: "idle" }
  | { phase: "unsaved" }
  | { phase: "saving" }
  | { phase: "saved"; at: number }
  | { phase: "error"; message: string }
  | { phase: "too_large" };

/** What the server reports back after storing a document. */
export interface NoteSaveResult {
  /** The stored document (the server stores the request body verbatim). */
  document: string;
  /** The stored row's `updatedAt`, for revision comparisons. */
  updatedAt: string | null;
}

export interface NoteSaveLoopOptions {
  /** The board every queued save belongs to. */
  boardId: string;
  /** Persist one serialized document and resolve with the stored document. */
  save(boardId: string, serialized: string): Promise<NoteSaveResult>;
  /** Observe the save status transitions emitted by the loop. */
  onStatus(status: NoteSaveStatus): void;
  /**
   * Content-aware equivalence used instead of plain string equality, so a
   * document that differs only in how images are served (local cache URL vs
   * canonical reference) counts as already saved. Defaults to `===`.
   */
  isEquivalent?(a: string, b: string): boolean;
  now?: () => number;
}

export class NoteSaveLoop {
  private readonly boardId: string;
  private lastSaved = "";
  private lastSavedUpdatedAt: string | null = null;
  private pending: string | null = null;
  private inFlight = false;
  private disposed = false;
  private readonly save: (boardId: string, serialized: string) => Promise<NoteSaveResult>;
  private readonly onStatus: (status: NoteSaveStatus) => void;
  private readonly isEquivalent: (a: string, b: string) => boolean;
  private readonly now: () => number;

  constructor(options: NoteSaveLoopOptions) {
    this.boardId = options.boardId;
    this.save = options.save;
    this.onStatus = options.onStatus;
    this.isEquivalent = options.isEquivalent ?? ((a, b) => a === b);
    this.now = options.now ?? (() => Date.now());
  }

  /** The board every save from this loop is written to. */
  get currentBoardId(): string {
    return this.boardId;
  }

  /** The document the loop currently considers persisted. */
  get lastSavedDocument(): string {
    return this.lastSaved;
  }

  /**
   * The `updatedAt` of the document the loop currently considers persisted.
   * Null until a load or save response has provided one.
   */
  get savedUpdatedAt(): string | null {
    return this.lastSavedUpdatedAt;
  }

  /** The newest document that still needs persisting, if any. */
  get pendingDocument(): string | null {
    return this.pending;
  }

  /** True while a save request is in flight. */
  get saving(): boolean {
    return this.inFlight;
  }

  /** Adopt a persisted document without saving it (load, sync refresh). */
  setSavedDocument(document: string, updatedAt: string | null = null): void {
    this.lastSaved = document;
    this.lastSavedUpdatedAt = updatedAt;
  }

  /** True when `serialized` represents content that is already stored. */
  isContentSaved(serialized: string): boolean {
    return this.isEquivalent(serialized, this.lastSaved);
  }

  /**
   * Record the editor's current serialized state. States that match the
   * stored document are not queued — unless a save is still in flight, which
   * may be about to store older content; in that case the current state is
   * remembered so the drain can converge the database once the in-flight save
   * finishes.
   *
   * Changes arriving after dispose are ignored: they come from a stale
   * editor, and persisting them could race the unmount/switch handoff that
   * already captured the newest state.
   */
  change(serialized: string): void {
    if (this.disposed) return;
    if (this.isEquivalent(serialized, this.lastSaved)) {
      this.pending = this.inFlight ? serialized : null;
      return;
    }
    this.pending = serialized;
  }

  /** Persist the pending state now (no-op while a save is already running). */
  flush(): void {
    if (this.disposed) return;
    void this.drain();
  }

  /**
   * Detach this loop from its component: stop emitting status and reject
   * further flushes. A drain already in flight keeps running so its queued
   * document still reaches the database, but silently.
   */
  dispose(): void {
    this.disposed = true;
  }

  private emit(status: NoteSaveStatus): void {
    if (this.disposed) return;
    this.onStatus(status);
  }

  private async drain(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      for (;;) {
        const serialized = this.pending;
        if (serialized === null) break;
        if (this.isEquivalent(serialized, this.lastSaved)) {
          this.pending = null;
          this.emit({ phase: "saved", at: this.now() });
          break;
        }
        this.emit({ phase: "saving" });
        try {
          const saved = await this.save(this.boardId, serialized);
          this.lastSaved = saved.document;
          this.lastSavedUpdatedAt = saved.updatedAt;
          if (this.pending === serialized) this.pending = null;
          if (this.pending === null) {
            this.emit({ phase: "saved", at: this.now() });
          }
        } catch (error) {
          // Keep the unsaved document queued so a retry can persist it, and
          // stop draining instead of looping on a failing request.
          if (error instanceof ClientApiError && error.status === 413) {
            this.emit({ phase: "too_large" });
          } else {
            this.emit({ phase: "error", message: errorMessage(error) });
          }
          return;
        }
      }
    } finally {
      this.inFlight = false;
    }
  }
}
