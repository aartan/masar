import { FileText, ListTree, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SaveIndicator } from "@/components/shared/save-indicator";
import { SpaceDescription } from "@/components/shared/space-description";
import type { NoteSaveStatus } from "@/lib/note-save-loop";
import type { BoardSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The note's header row: space name and description, the save indicator, the
 * outline toggle and the settings entry point.
 */
export function NoteHeader({
  board,
  readOnly,
  status,
  lastSavedAt,
  offline,
  outlineOpen,
  onToggleOutline,
  onRetry,
  onOpenSettings,
}: {
  board: BoardSummary;
  readOnly: boolean;
  status: NoteSaveStatus;
  lastSavedAt: number | null;
  offline: boolean;
  outlineOpen: boolean;
  onToggleOutline: () => void;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border/60 bg-background/65 px-4 py-3 sm:px-6">
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate font-display text-[15px] font-semibold">
            {board.name}
          </h1>
          {readOnly && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Read-only (archived)
            </span>
          )}
        </div>
        <SpaceDescription description={board.description} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <SaveIndicator
          status={status}
          onRetry={onRetry}
          offline={offline}
          lastSavedAt={lastSavedAt}
        />
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={outlineOpen ? "Hide outline" : "Show outline"}
          aria-pressed={outlineOpen}
          data-selected={outlineOpen || undefined}
          className={cn(outlineOpen && "bg-accent text-accent-foreground")}
          onClick={onToggleOutline}
        >
          <ListTree className="size-3.5" />
        </Button>
        {!readOnly && (
          <Button
            variant="outline"
            size="icon-sm"
            onClick={onOpenSettings}
            aria-label="Note settings"
          >
            <Settings2 className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
