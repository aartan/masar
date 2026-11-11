import { beforeEach, describe, expect, it } from "vitest";

import {
  forgetPendingDocument,
  pendingDocumentCount,
  rememberPendingDocument,
  resetPendingDocuments,
  takePendingDocument,
} from "@/lib/note-pending-document";

describe("pending note documents", () => {
  beforeEach(() => {
    resetPendingDocuments();
  });

  it("hands the unsaved document to the next mount of the same board only", () => {
    rememberPendingDocument("board-a", "doc-a");
    rememberPendingDocument("board-b", "doc-b");

    expect(takePendingDocument("board-a", "persisted-a")).toBe("doc-a");
    expect(takePendingDocument("board-b", "persisted-b")).toBe("doc-b");
  });

  it("clears an entry that matches the persisted document", () => {
    rememberPendingDocument("board-a", "doc-a");
    expect(takePendingDocument("board-a", "doc-a")).toBeNull();
    expect(pendingDocumentCount()).toBe(0);
  });

  it("clears entries explicitly through forget", () => {
    rememberPendingDocument("board-a", "doc-a");
    forgetPendingDocument("board-a");
    expect(takePendingDocument("board-a", "persisted")).toBeNull();
    expect(pendingDocumentCount()).toBe(0);
  });

  it("keeps entries until a save confirms or the content matches", () => {
    rememberPendingDocument("board-a", "doc-a");
    rememberPendingDocument("board-b", "doc-b");

    // Taking returns the document; the entry stays registered until the
    // resumed save confirms it (the caller forgets it on "saved").
    expect(takePendingDocument("board-a", "persisted-a")).toBe("doc-a");
    expect(pendingDocumentCount()).toBe(2);

    forgetPendingDocument("board-a");
    expect(pendingDocumentCount()).toBe(1);

    forgetPendingDocument("board-b");
    expect(pendingDocumentCount()).toBe(0);
  });
});
