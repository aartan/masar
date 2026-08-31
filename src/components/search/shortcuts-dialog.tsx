"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/shared/empty-state";

const SHORTCUTS = [
  { keys: ["⌘", "K"], label: "Search tasks and boards", alternate: "Ctrl K" },
  { keys: ["N"], label: "Create a task on the current board" },
  { keys: ["?"], label: "Show this shortcut guide" },
  { keys: ["Esc"], label: "Close a panel or dialog" },
  { keys: ["Tab"], label: "Move through controls and fields" },
  { keys: ["Space"], label: "Pick up a task with the drag handle" },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Move through Masar without reaching for the mouse.
          </DialogDescription>
        </DialogHeader>
        <div className="divide-y divide-border/60">
          {SHORTCUTS.map((shortcut) => (
            <div
              key={shortcut.label}
              className="flex items-center justify-between gap-6 py-2.5"
            >
              <span className="text-[13px] text-muted-foreground">
                {shortcut.label}
                {shortcut.alternate && (
                  <span className="ml-1 text-[11px] text-muted-foreground/50">
                    ({shortcut.alternate})
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {shortcut.keys.map((key) => (
                  <Kbd key={key} className="h-5 min-w-6">
                    {key}
                  </Kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
          Tip: every card has a drag handle. Keyboard drag-and-drop is available
          when the handle is focused.
        </p>
      </DialogContent>
    </Dialog>
  );
}
