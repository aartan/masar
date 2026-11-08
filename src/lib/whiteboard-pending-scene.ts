import { sameSceneContent } from "@/lib/whiteboard-scene";

/**
 * In-memory registry of the newest unsaved whiteboard scene per board.
 *
 * Navigating away from a whiteboard unmounts its component, and with it the
 * save loop that held the latest serialized state. When the scene save is
 * still in flight (for example its images are uploading to R2), the persisted
 * scene may lag behind the canvas. The registry hands the unsaved scene to
 * the next mount of the same board so no work — and no image — disappears
 * just because the user switched boards.
 *
 * Entries are cleared when a save confirms the scene (see the save loop's
 * `saved` status) or when the canvas returns to the persisted state.
 */

const pendingScenes = new Map<string, string>();

/** Remember the board's current unsaved state. */
export function rememberPendingScene(boardId: string, scene: string): void {
  pendingScenes.set(boardId, scene);
}

/** Drop the board's unsaved state (it has been persisted). */
export function forgetPendingScene(boardId: string): void {
  pendingScenes.delete(boardId);
}

/**
 * The unsaved scene for a board, or null when none exists or it already
 * matches the persisted scene. A stale entry is cleared before returning.
 */
export function takePendingScene(
  boardId: string,
  persistedScene: string,
): string | null {
  const pending = pendingScenes.get(boardId);
  if (pending === undefined) return null;
  if (pending === persistedScene || sameSceneContent(pending, persistedScene)) {
    pendingScenes.delete(boardId);
    return null;
  }
  return pending;
}

/** For tests: whether any unsaved scenes are currently registered. */
export function pendingSceneCount(): number {
  return pendingScenes.size;
}

/** For tests: reset the registry between cases. */
export function resetPendingScenes(): void {
  pendingScenes.clear();
}
