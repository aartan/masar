import { Check, CloudOff, Loader2, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import type { NoteSaveStatus } from "@/lib/note-save-loop";
import type { WhiteboardSaveStatus } from "@/lib/whiteboard-save-loop";

export type SaveStatus = WhiteboardSaveStatus | NoteSaveStatus;

/**
 * Subtle autosave indicator shared by the whiteboard and note editors.
 * Renders nothing while idle, so it only appears once a save is in flight,
 * failed, or has confirmed a user-visible "Saved" state.
 */
export function SaveIndicator({
  status,
  onRetry,
  tooLargeLabel = "Too large to save — reduce images",
}: {
  status: SaveStatus;
  onRetry: () => void;
  tooLargeLabel?: string;
}) {
  if (status.phase === "unsaved") {
    return (
      <span className="text-[12px] text-muted-foreground">Unsaved changes</span>
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
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Check className="size-3.5 text-success" />
        Saved
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
