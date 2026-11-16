/**
 * Helpers for placing the note editor's caret from a click on the writing
 * canvas.
 *
 * BlockNote handles clicks that land inside its contenteditable element
 * natively. The note also has padding and side margins around that element,
 * and those clicks should behave like a native note canvas: clicking above or
 * below the document moves the caret to its start or end, and clicking beside
 * a line moves the caret to that line's nearest edge.
 */

export interface NoteCaretBlock {
  /** The BlockNote block id the caret should move into. */
  blockId: string;
  /** Viewport coordinates of the block's text content box. */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface NoteCaretTarget {
  blockId: string;
  placement: "start" | "end";
}

/**
 * Pick the caret target nearest to a pointer on the note canvas.
 *
 * `blocks` must be ordered top to bottom. Returns null when the document has
 * no text-bearing blocks.
 */
export function pickNoteCaretTarget(
  blocks: NoteCaretBlock[],
  point: { x: number; y: number },
): NoteCaretTarget | null {
  const first = blocks[0];
  if (!first) return null;

  if (point.y <= first.top) {
    return { blockId: first.blockId, placement: "start" };
  }

  const last = blocks[blocks.length - 1]!;
  if (point.y >= last.bottom) {
    return { blockId: last.blockId, placement: "end" };
  }

  const containing = blocks.find(
    (block) => point.y >= block.top && point.y <= block.bottom,
  );
  if (containing) {
    const middle = containing.left + (containing.right - containing.left) / 2;
    return {
      blockId: containing.blockId,
      placement: point.x < middle ? "start" : "end",
    };
  }

  // The pointer is in the small gap between two blocks (for example block
  // margins). Snap to the closer edge of the closer block.
  let nearest = first;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const block of blocks) {
    const distance =
      point.y < block.top ? block.top - point.y : point.y - block.bottom;
    if (distance < nearestDistance) {
      nearest = block;
      nearestDistance = distance;
    }
  }

  return {
    blockId: nearest.blockId,
    placement: point.y < nearest.top ? "start" : "end",
  };
}
