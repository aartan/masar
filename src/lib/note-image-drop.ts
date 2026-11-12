import type { BlockNoteEditor } from "@blocknote/core";

export interface NoteDropPoint {
  clientX: number;
  clientY: number;
}

export interface NoteDropAnchor {
  blockId: string;
  placement: "before" | "after";
}

export interface NoteDropBlock {
  blockId: string;
  top: number;
  bottom: number;
}

/** True while a drag carries files rather than text or editor blocks. */
export function hasFileDrag(dataTransfer: DataTransfer | null): boolean {
  return Boolean(
    dataTransfer && Array.from(dataTransfer.types).includes("Files"),
  );
}

/**
 * BlockNote binds its file-drop handler to the editable `.bn-editor` element.
 * The surrounding note margins belong to ancestors, so those drops never reach
 * it. Detect them here and leave in-editor drops to BlockNote.
 */
export function isNoteEditorTarget(
  editor: BlockNoteEditor,
  target: EventTarget | null,
): boolean {
  const editorElement = editor.domElement;
  return Boolean(
    editorElement && target instanceof Node && editorElement.contains(target),
  );
}

/**
 * Choose the block a drop should be inserted next to. Drops above or below the
 * document go before the first block or after the last one; otherwise the drop
 * lands before/after the block under the pointer by its vertical midpoint.
 */
export function pickNoteDropAnchor(
  blocks: NoteDropBlock[],
  clientY: number,
): NoteDropAnchor | null {
  const first = blocks[0];
  if (!first) return null;
  if (clientY <= first.top) {
    return { blockId: first.blockId, placement: "before" };
  }

  const last = blocks[blocks.length - 1]!;
  if (clientY >= last.bottom) {
    return { blockId: last.blockId, placement: "after" };
  }

  for (const block of blocks) {
    if (clientY < block.top) {
      return { blockId: block.blockId, placement: "before" };
    }
    if (clientY <= block.bottom) {
      const middle = (block.top + block.bottom) / 2;
      return {
        blockId: block.blockId,
        placement: clientY < middle ? "before" : "after",
      };
    }
  }

  return { blockId: last.blockId, placement: "after" };
}

function findNoteDropAnchor(
  editor: BlockNoteEditor,
  point: NoteDropPoint,
): NoteDropAnchor | null {
  const editorElement = editor.domElement;
  const blocks: NoteDropBlock[] = [];

  if (editorElement) {
    const elements = editorElement.querySelectorAll<HTMLElement>(
      ":scope > .bn-block-group > .bn-block-outer[data-id]",
    );
    for (const element of elements) {
      const blockId = element.getAttribute("data-id");
      if (!blockId || !editor.getBlock(blockId)) continue;
      const rect = element.getBoundingClientRect();
      blocks.push({ blockId, top: rect.top, bottom: rect.bottom });
    }
  }

  const anchor = pickNoteDropAnchor(blocks, point.clientY);
  if (anchor) return anchor;

  // The editor has not mounted its DOM yet: append to the document instead.
  const lastBlock = editor.document[editor.document.length - 1];
  return lastBlock ? { blockId: lastBlock.id, placement: "after" } : null;
}

/**
 * Upload files dropped outside BlockNote's editable surface and insert them as
 * image blocks at the drop position. Upload failures are reported by
 * `uploadFile`; insertion failures are left to the caller.
 */
export async function insertDroppedNoteImages({
  editor,
  files,
  point,
  uploadFile,
}: {
  editor: BlockNoteEditor;
  files: File[];
  point: NoteDropPoint;
  uploadFile: (file: File) => Promise<string>;
}): Promise<void> {
  if (files.length === 0) return;

  let anchor = findNoteDropAnchor(editor, point);
  if (!anchor) return;

  for (const file of files) {
    let url: string;
    try {
      url = await uploadFile(file);
    } catch {
      // uploadFile already reports validation and storage failures.
      continue;
    }

    if (!editor.getBlock(anchor.blockId)) {
      const lastBlock = editor.document[editor.document.length - 1];
      if (!lastBlock) return;
      anchor = { blockId: lastBlock.id, placement: "after" };
    }

    const [inserted] = editor.insertBlocks(
      [{ type: "image", props: { url } }],
      anchor.blockId,
      anchor.placement,
    );
    if (!inserted) {
      throw new Error("BlockNote did not insert the image block");
    }

    // Keep multiple dropped images in the order they were dropped.
    anchor = { blockId: inserted.id, placement: "after" };
  }
}
