import * as React from "react";

import { type BlockNoteEditor } from "@blocknote/core";
import { BlockNoteViewEditor } from "@blocknote/react";

import { NoteOutline } from "@/components/note/note-outline";
import { pickNoteCaretTarget, type NoteCaretBlock } from "@/lib/note-caret";
import { NOTE_WIDTH_CLASSES, type NoteWidth } from "@/lib/use-note-width";

/**
 * The editor's reading surface: the scrollable column with the chosen note
 * width plus the floating outline panel. Width changes only affect the
 * column's maximum width — never the document content.
 *
 * The whole canvas behaves like a native note surface: the editor grows to
 * fill the available height, so blank space below the document remains
 * editable, and clicks on the surrounding margins place the caret at the
 * nearest block edge instead of doing nothing.
 */
export function NoteEditorContent({
  editor,
  readOnly,
  noteWidth,
  outlineOpen,
  onOutlineClose,
}: {
  editor: BlockNoteEditor;
  readOnly: boolean;
  noteWidth: NoteWidth;
  outlineOpen: boolean;
  onOutlineClose: () => void;
}) {
  const placeCaretFromCanvas = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (
        readOnly ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;
      // BlockNote and ProseMirror own every click that lands on the editor
      // itself, including text selection, links and embedded blocks.
      if (target.closest(".bn-editor")) return;
      if (
        target.closest(
          "a, button, input, textarea, select, [role='button'], [role='checkbox']",
        )
      ) {
        return;
      }

      // Ignore scrollbar presses; they belong to the scroll container, not
      // the writing surface.
      const canvas = event.currentTarget;
      const bounds = canvas.getBoundingClientRect();
      if (
        event.clientX >= bounds.left + canvas.clientWidth ||
        event.clientY >= bounds.top + canvas.clientHeight
      ) {
        return;
      }

      const caret = pickNoteCaretTarget(collectNoteCaretBlocks(editor), {
        x: event.clientX,
        y: event.clientY,
      });
      if (!caret) return;

      event.preventDefault();
      try {
        editor.setTextCursorPosition(caret.blockId, caret.placement);
        editor.focus();
      } catch {
        // The document may have changed since the block bounds were read.
      }
    },
    [editor, readOnly],
  );

  return (
    <div className="relative min-h-0 flex-1">
      <div
        className="scrollbar-thin h-full overflow-y-auto"
        data-note-editable={!readOnly}
        onMouseDown={placeCaretFromCanvas}
      >
        <div
          className={`masar-note-content mx-auto flex min-h-full w-full flex-col ${NOTE_WIDTH_CLASSES[noteWidth]} px-3 py-3 sm:px-4 sm:py-4`}
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

/**
 * The viewport bounds of every block with editable text, in document order.
 * Non-text blocks (images, dividers, tables) are skipped so a margin click
 * always lands in real content.
 */
function collectNoteCaretBlocks(editor: BlockNoteEditor): NoteCaretBlock[] {
  const root = editor.domElement;
  if (!root) return [];

  const blocks: NoteCaretBlock[] = [];
  const elements = root.querySelectorAll<HTMLElement>(".bn-block-content");
  for (const element of elements) {
    if (!element.querySelector(".bn-inline-content")) continue;

    const container = element.closest<HTMLElement>(
      '[data-node-type="blockContainer"][data-id]',
    );
    const blockId = container?.dataset.id;
    if (!blockId || !editor.getBlock(blockId)) continue;

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    blocks.push({
      blockId,
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
    });
  }

  blocks.sort((a, b) => a.top - b.top);
  return blocks;
}
