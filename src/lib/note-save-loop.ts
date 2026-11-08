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
 */
export type NoteSaveStatus =
  | { phase: "idle" }
  | { phase: "unsaved" }
  | { phase: "saving" }
  | { phase: "saved"; at: number }
  | { phase: "error"; message: string }
  | { phase: "too_large" };

export interface NoteSaveLoopOptions {
  /** Persist one serialized document and resolve with the stored document. */
  save(serialized: string): Promise<string>;
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
  private lastSaved = "";
  private pending: string | null = null;
  private inFlight = false;
  private readonly save: (serialized: string) => Promise<string>;
  private readonly onStatus: (status: NoteSaveStatus) => void;
  private readonly isEquivalent: (a: string, b: string) => boolean;
  private readonly now: () => number;

  constructor(options: NoteSaveLoopOptions) {
    this.save = options.save;
    this.onStatus = options.onStatus;
    this.isEquivalent = options.isEquivalent ?? ((a, b) => a === b);
    this.now = options.now ?? (() => Date.now());
  }

  /** The document the loop currently considers persisted. */
  get lastSavedDocument(): string {
    return this.lastSaved;
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
  setSavedDocument(document: string): void {
    this.lastSaved = document;
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
   */
  change(serialized: string): void {
    if (this.isEquivalent(serialized, this.lastSaved)) {
      this.pending = this.inFlight ? serialized : null;
      return;
    }
    this.pending = serialized;
  }

  /** Persist the pending state now (no-op while a save is already running). */
  flush(): void {
    void this.drain();
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
          this.onStatus({ phase: "saved", at: this.now() });
          break;
        }
        this.onStatus({ phase: "saving" });
        try {
          const saved = await this.save(serialized);
          this.lastSaved = saved;
          if (this.pending === serialized) this.pending = null;
          if (this.pending === null) {
            this.onStatus({ phase: "saved", at: this.now() });
          }
        } catch (error) {
          // Keep the unsaved document queued so a retry can persist it, and
          // stop draining instead of looping on a failing request.
          if (error instanceof ClientApiError && error.status === 413) {
            this.onStatus({ phase: "too_large" });
          } else {
            this.onStatus({ phase: "error", message: errorMessage(error) });
          }
          return;
        }
      }
    } finally {
      this.inFlight = false;
    }
  }
}
