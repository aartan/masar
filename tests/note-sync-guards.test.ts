import { describe, expect, it } from "vitest";

import { shouldApplyRemoteDocument } from "@/lib/note-sync-guards";

const DOC = JSON.stringify([
  { id: "block-1", type: "paragraph", content: [{ type: "text", text: "Hi" }] },
]);

function decision(overrides: Partial<Parameters<typeof shouldApplyRemoteDocument>[0]>) {
  return shouldApplyRemoteDocument({
    pendingDocument: null,
    saving: false,
    remote: DOC,
    lastSavedDocument: DOC,
    boardId: "board-1",
    remoteUpdatedAt: "t1",
    savedUpdatedAt: "t1",
    ...overrides,
  });
}

describe("shouldApplyRemoteDocument", () => {
  it("never replaces an editor with pending local edits", () => {
    expect(
      decision({
        pendingDocument: "unsaved",
        lastSavedDocument: "older",
        remote: "newer",
      }),
    ).toBe(false);
  });

  it("never replaces an editor with an in-flight save", () => {
    expect(
      decision({ saving: true, lastSavedDocument: "older", remote: "newer" }),
    ).toBe(false);
  });

  it("skips a refresh whose revision already matches what is tracked", () => {
    expect(decision({})).toBe(false);
  });

  it("skips remote content equivalent to the persisted document", () => {
    expect(
      decision({
        remoteUpdatedAt: "t2",
        savedUpdatedAt: "t1",
        remote: DOC,
        lastSavedDocument: DOC,
      }),
    ).toBe(false);
  });

  it("skips content-equivalent documents that differ only in image serving URLs", () => {
    const withImage = (url: string) =>
      JSON.stringify([{ id: "b", type: "image", props: { url } }]);
    expect(
      decision({
        remoteUpdatedAt: "t2",
        savedUpdatedAt: "t1",
        remote: withImage("/api/boards/board-1/images/img-1/cache"),
        lastSavedDocument: withImage("/api/images/img-1"),
      }),
    ).toBe(false);
  });

  it("applies a genuinely changed remote document", () => {
    expect(
      decision({
        remoteUpdatedAt: "t2",
        savedUpdatedAt: "t1",
        remote: DOC,
        lastSavedDocument: "[]",
      }),
    ).toBe(true);
  });

  it("falls back to a content comparison when revisions are unknown", () => {
    expect(
      decision({
        remoteUpdatedAt: null,
        savedUpdatedAt: null,
        remote: DOC,
        lastSavedDocument: "[]",
      }),
    ).toBe(true);
  });
});
