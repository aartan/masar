import { Check, CloudOff, Loader2, RefreshCw } from "lucide-react";

import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { NoteSaveStatus } from "@/lib/note-save-loop";
import type { WhiteboardSaveStatus } from "@/lib/whiteboard-save-loop";

export type SaveStatus = WhiteboardSaveStatus | NoteSaveStatus;

/** Compact "just now / 5m ago" label for the last successful save. */
function compactRelative(timestamp: number): string {
  const elapsed = Date.now() - timestamp;
  if (elapsed < 5_000) return "just now";
  const seconds = Math.floor(elapsed / 1_000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Subtle autosave indicator shared by the whiteboard and note editors.
 * Renders nothing while idle, so it only appears once a save is in flight,
 * failed, or has confirmed a user-visible "Saved" state.
 *
 * `offline` marks the device as disconnected: saves land in the local
 * database and synchronize when connectivity returns, which the indicator
 * reflects. `lastSavedAt` shows the time of the last successful save.
 */
export function SaveIndicator({
  status,
  onRetry,
  tooLargeLabel = "Too large to save — reduce images",
  offline = false,
  lastSavedAt = null,
}: {
  status: SaveStatus;
  onRetry: () => void;
  tooLargeLabel?: string;
  offline?: boolean;
  lastSavedAt?: number | null;
}) {
  if (status.phase === "unsaved") {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        {offline && (
          <CloudOff
            className="size-3.5"
            aria-label="Offline — changes are kept on this device"
          />
        )}
        Unsaved changes
      </span>
    );
  }
  if (status.phase === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Saving…
      </span>
    );
  }
  if (status.phase === "saved") {
    if (offline) {
      return (
        <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <CloudOff className="size-3.5" />
          Saved on this device
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Check className="size-3.5 text-success" />
        <span>Saved</span>
        {lastSavedAt !== null && (
          <span
            className="text-muted-foreground/80"
            title={formatDateTime(new Date(lastSavedAt).toISOString())}
          >
            · {compactRelative(lastSavedAt)}
          </span>
        )}
      </span>
    );
  }
  if (status.phase === "too_large") {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-warning">
        <CloudOff className="size-3.5" />
        {tooLargeLabel}
      </span>
    );
  }
  if (status.phase === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12px] text-warning transition-colors hover:bg-warning/10",
        )}
        title={status.message}
      >
        <RefreshCw className="size-3.5" />
        Couldn’t save — retry
      </button>
    );
  }
  return null;
}
