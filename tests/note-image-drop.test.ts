import { describe, expect, it } from "vitest";

import { pickNoteDropAnchor } from "@/lib/note-image-drop";

const BLOCKS = [
  { blockId: "first", top: 100, bottom: 140 },
  { blockId: "second", top: 150, bottom: 190 },
  { blockId: "third", top: 200, bottom: 260 },
];

describe("pickNoteDropAnchor", () => {
  it("inserts before the first block when dropped above the document", () => {
    expect(pickNoteDropAnchor(BLOCKS, 80)).toEqual({
      blockId: "first",
      placement: "before",
    });
  });

  it("uses the block midpoint to choose before or after", () => {
    expect(pickNoteDropAnchor(BLOCKS, 110)).toEqual({
      blockId: "first",
      placement: "before",
    });
    expect(pickNoteDropAnchor(BLOCKS, 130)).toEqual({
      blockId: "first",
      placement: "after",
    });
  });

  it("inserts before the next block when dropped in a gap", () => {
    expect(pickNoteDropAnchor(BLOCKS, 145)).toEqual({
      blockId: "second",
      placement: "before",
    });
  });

  it("appends after the last block when dropped below the document", () => {
    expect(pickNoteDropAnchor(BLOCKS, 300)).toEqual({
      blockId: "third",
      placement: "after",
    });
  });

  it("has no anchor when the document has no blocks", () => {
    expect(pickNoteDropAnchor([], 120)).toBeNull();
  });
});
