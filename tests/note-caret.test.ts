import { describe, expect, it } from "vitest";

import { pickNoteCaretTarget } from "@/lib/note-caret";

const BLOCKS = [
  { blockId: "first", top: 100, bottom: 140, left: 20, right: 620 },
  { blockId: "second", top: 150, bottom: 190, left: 20, right: 620 },
  { blockId: "third", top: 200, bottom: 260, left: 20, right: 620 },
];

describe("pickNoteCaretTarget", () => {
  it("moves to the start of the document when clicking above it", () => {
    expect(pickNoteCaretTarget(BLOCKS, { x: 100, y: 80 })).toEqual({
      blockId: "first",
      placement: "start",
    });
  });

  it("appends to the last block when clicking below the document", () => {
    expect(pickNoteCaretTarget(BLOCKS, { x: 100, y: 300 })).toEqual({
      blockId: "third",
      placement: "end",
    });
  });

  it("uses the clicked line and switches edge by horizontal position", () => {
    expect(pickNoteCaretTarget(BLOCKS, { x: 100, y: 170 })).toEqual({
      blockId: "second",
      placement: "start",
    });
    expect(pickNoteCaretTarget(BLOCKS, { x: 500, y: 170 })).toEqual({
      blockId: "second",
      placement: "end",
    });
  });

  it("snaps to the closer block edge when clicking a gap", () => {
    expect(pickNoteCaretTarget(BLOCKS, { x: 100, y: 143 })).toEqual({
      blockId: "first",
      placement: "end",
    });
    expect(pickNoteCaretTarget(BLOCKS, { x: 100, y: 148 })).toEqual({
      blockId: "second",
      placement: "start",
    });
  });

  it("has no target when the document has no text blocks", () => {
    expect(pickNoteCaretTarget([], { x: 100, y: 120 })).toBeNull();
  });
});
