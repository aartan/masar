import { ClientApiError, errorMessage } from "@/lib/client-api";
import { sameSceneContent } from "@/lib/whiteboard-scene";

/**
 * Serializes whiteboard scene saves.
 *
 * Saving a whiteboard can be slow: premium scenes upload their images to R2
 * during the save, so a PUT can take seconds. Saves must therefore never
 * overlap. Overlapping PUTs can commit out of order in the database (an older
 * scene overwriting a newer one) and their responses can update the tracked
 * canonical scene with stale content — which previously left the canvas
 * re-saving forever or showing a "saved" state that did not match the
 * database, and a debounced save that found its content already persisted
 * returned without updating the indicator, leaving it stuck at "Unsaved
 * changes".
 *
 * The loop keeps at most one request in flight. The newest canvas state is
 * always queued in `pending`; every completed save immediately drains the
 * queue again, so the last write always carries the newest state and
 * responses can never arrive out of order.
 */
export type WhiteboardSaveStatus =
  | { phase: "idle" }
  | { phase: "unsaved" }
  | { phase: "saving" }
  | { phase: "saved"; at: number }
  | { phase: "error"; message: string }
  | { phase: "too_large" };

export interface WhiteboardSaveLoopOptions {
  /**
   * Persist one serialized scene and resolve with the canonical scene the
   * server stored (it may replace embedded images with `masar://`
   * references).
   */
  save(serialized: string): Promise<string>;
  /** Observe the save status transitions emitted by the loop. */
  onStatus(status: WhiteboardSaveStatus): void;
  now?: () => number;
}

export class WhiteboardSaveLoop {
  private lastSaved = "";
  private pending: string | null = null;
  private inFlight = false;
  private readonly save: (serialized: string) => Promise<string>;
  private readonly onStatus: (status: WhiteboardSaveStatus) => void;
  private readonly now: () => number;

  constructor(options: WhiteboardSaveLoopOptions) {
    this.save = options.save;
    this.onStatus = options.onStatus;
    this.now = options.now ?? (() => Date.now());
  }

  /** The canonical scene the loop currently considers persisted. */
  get lastSavedScene(): string {
    return this.lastSaved;
  }

  /** The newest canvas state that still needs persisting, if any. */
  get pendingScene(): string | null {
    return this.pending;
  }

  /** True while a save request is in flight. */
  get saving(): boolean {
    return this.inFlight;
  }

  /** Adopt a persisted scene without saving it (scene load, sync refresh). */
  setSavedScene(scene: string): void {
    this.lastSaved = scene;
  }

  /** True when `serialized` represents content that is already stored. */
  isContentSaved(serialized: string): boolean {
    return (
      serialized === this.lastSaved ||
      sameSceneContent(serialized, this.lastSaved)
    );
  }

  /**
   * Record the canvas's current serialized state. States that match the
   * stored scene are not queued — unless a save is still in flight, which may
   * be about to store older content; in that case the current state is
   * remembered so the drain can converge the database once the in-flight save
   * finishes. States that differ from the stored scene only in how images are
   * referenced (`masar://` ids or embedded data) count as already saved.
   */
  change(serialized: string): void {
    if (serialized === this.lastSaved) {
      this.pending = this.inFlight ? serialized : null;
      return;
    }
    if (!this.inFlight && sameSceneContent(serialized, this.lastSaved)) {
      this.pending = null;
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
        if (
          serialized === this.lastSaved ||
          sameSceneContent(serialized, this.lastSaved)
        ) {
          // The queued state matches the stored scene; only its image
          // references differ. Adopt the stored scene instead of re-saving
          // the same content forever.
          this.pending = null;
          this.onStatus({ phase: "saved", at: this.now() });
          break;
        }
        this.onStatus({ phase: "saving" });
        try {
          const saved = await this.save(serialized);
          // The server may have replaced embedded images with references, so
          // the canonical saved scene (not the request body) is what we
          // compare against next time.
          this.lastSaved = saved;
          if (this.pending === serialized) this.pending = null;
          if (this.pending === null) {
            this.onStatus({ phase: "saved", at: this.now() });
          }
        } catch (error) {
          // Keep the unsaved content queued so a retry can persist it, and
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
