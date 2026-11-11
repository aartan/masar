import * as React from "react";

import { ListTree, X } from "lucide-react";
import { type BlockNoteEditor } from "@blocknote/core";
import { useEditorChange } from "@blocknote/react";

import { Button } from "@/components/ui/button";
import {
  collectNoteHeadings,
  type NoteHeading,
} from "@/lib/note-document";
import { cn } from "@/lib/utils";

/**
 * Document outline generated from the note's heading blocks. Renders as a
 * pinned panel over the right edge of the editor area; clicking an entry
 * moves the cursor to the heading and scrolls it into view.
 */
export function NoteOutline({
  editor,
  open,
  onClose,
}: {
  editor: BlockNoteEditor;
  open: boolean;
  onClose: () => void;
}) {
  const [headings, setHeadings] = React.useState<NoteHeading[]>([]);

  const refresh = React.useCallback(() => {
    setHeadings(collectNoteHeadings(JSON.stringify(editor.document)));
  }, [editor]);

  React.useEffect(refresh, [refresh]);
  useEditorChange(refresh, editor);

  const jumpToHeading = React.useCallback(
    (id: string) => {
      const target = editor.document.find((entry) => entry.id === id);
      if (!target) return;
      editor.setTextCursorPosition(target, "start");
      editor.focus();
      const element = editor.domElement?.querySelector(
        `[data-id="${CSS.escape(id)}"]`,
      );
      element?.scrollIntoView({ block: "start", behavior: "smooth" });
    },
    [editor],
  );

  if (!open) return null;

  return (
    <div
      className="masar-note-outline absolute inset-y-3 right-3 z-20 flex w-60 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border border-border/70 bg-background/95 shadow-float backdrop-blur"
      role="complementary"
      aria-label="Note outline"
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <ListTree className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[12px] font-medium">Outline</span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto size-6"
          aria-label="Close outline"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1.5">
        {headings.length === 0 ? (
          <p className="px-2.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
            No headings yet. Headings you add appear here for quick
            navigation.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {headings.map((heading) => (
              <li key={heading.id}>
                <button
                  type="button"
                  className={cn(
                    "w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[12.5px] leading-snug text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                    heading.level === 2 && "pl-6",
                    heading.level >= 3 && "pl-9",
                    heading.level === 1 && "font-medium text-foreground",
                  )}
                  onClick={() => jumpToHeading(heading.id)}
                >
                  {heading.text || "Untitled heading"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
