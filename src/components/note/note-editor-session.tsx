import { type BlockNoteEditor } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";

import { NoteEditorContent } from "@/components/note/note-editor-content";
import { NoteFormattingToolbar } from "@/components/note/note-toolbar";
import type { NoteWidth } from "@/lib/use-note-width";

/**
 * The mounted BlockNote editor session: the editor surface, the formatting
 * toolbar and the reading column. Owned by NoteView, which supplies the
 * editor instance, change handler and upload callback.
 */
export function NoteEditorSession({
  editor,
  readOnly,
  theme,
  noteWidth,
  onNoteWidthChange,
  outlineOpen,
  onOutlineClose,
  handleEditorChange,
  uploadFile,
}: {
  editor: BlockNoteEditor;
  readOnly: boolean;
  theme: "light" | "dark";
  noteWidth: NoteWidth;
  onNoteWidthChange: (width: NoteWidth) => void;
  outlineOpen: boolean;
  onOutlineClose: () => void;
  handleEditorChange: (editor: BlockNoteEditor) => void;
  uploadFile: (file: File, blockId?: string) => Promise<string>;
}) {
  return (
    <BlockNoteView
      editor={editor}
      theme={theme}
      editable={!readOnly}
      onChange={handleEditorChange}
      formattingToolbar={false}
      slashMenu={false}
      sideMenu={false}
      renderEditor={false}
      className="flex min-h-0 flex-1 flex-col"
    >
      {!readOnly && (
        <NoteFormattingToolbar
          editor={editor}
          noteWidth={noteWidth}
          onNoteWidthChange={onNoteWidthChange}
          uploadFile={uploadFile}
        />
      )}
      <NoteEditorContent
        editor={editor}
        noteWidth={noteWidth}
        outlineOpen={outlineOpen}
        onOutlineClose={onOutlineClose}
      />
    </BlockNoteView>
  );
}
