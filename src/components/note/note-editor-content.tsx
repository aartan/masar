import { type BlockNoteEditor } from "@blocknote/core";
import { BlockNoteViewEditor } from "@blocknote/react";

import { NoteOutline } from "@/components/note/note-outline";
import { NOTE_WIDTH_CLASSES, type NoteWidth } from "@/lib/use-note-width";

/**
 * The editor's reading surface: the scrollable column with the chosen note
 * width plus the floating outline panel. Width changes only affect the
 * column's maximum width — never the document content.
 */
export function NoteEditorContent({
  editor,
  noteWidth,
  outlineOpen,
  onOutlineClose,
}: {
  editor: BlockNoteEditor;
  noteWidth: NoteWidth;
  outlineOpen: boolean;
  onOutlineClose: () => void;
}) {
  return (
    <div className="relative min-h-0 flex-1">
      <div className="scrollbar-thin h-full overflow-y-auto">
        <div
          className={`masar-note-content mx-auto w-full ${NOTE_WIDTH_CLASSES[noteWidth]} px-3 py-3 sm:px-4 sm:py-4`}
        >
          <BlockNoteViewEditor />
        </div>
      </div>
      <NoteOutline
        editor={editor}
        open={outlineOpen}
        onClose={onOutlineClose}
      />
    </div>
  );
}
