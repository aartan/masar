import { describe, expect, it } from "vitest";

import {
  canonicalizeNoteDocument,
  collectNoteHeadings,
  collectNoteImageIds,
  isWellFormedNoteDocument,
  noteDocumentsEquivalent,
  noteImageCacheUrl,
  noteImageUrlId,
  parseNoteDocument,
  rewriteNoteImageUrls,
} from "@/lib/note-document";

const DOCUMENT = JSON.stringify([
  {
    id: "block-1",
    type: "paragraph",
    content: [{ type: "text", text: "Intro" }],
  },
  {
    id: "block-2",
    type: "image",
    props: { url: "/api/images/image-1", caption: "First" },
  },
  {
    id: "block-3",
    type: "columnList",
    content: [
      {
        id: "block-4",
        type: "image",
        props: { url: "/api/images/image-2" },
      },
    ],
  },
]);

describe("note document helpers", () => {
  it("parses a document and collects nested image ids", () => {
    expect(parseNoteDocument(DOCUMENT)).toHaveLength(3);
    expect(collectNoteImageIds(DOCUMENT)).toEqual(["image-1", "image-2"]);
  });

  it("returns an empty id list for malformed or empty documents", () => {
    expect(collectNoteImageIds("not json")).toEqual([]);
    expect(collectNoteImageIds(JSON.stringify({ not: "an array" }))).toEqual([]);
    expect(collectNoteImageIds(null)).toEqual([]);
  });

  it("recognizes only note image urls", () => {
    expect(noteImageUrlId("/api/images/image-1")).toBe("image-1");
    expect(noteImageUrlId("data:image/png;base64,abc")).toBeNull();
    expect(noteImageUrlId("https://example.test/image.png")).toBeNull();
  });

  it("rewrites image urls through a mapper and preserves unknown fields", () => {
    const rewritten = rewriteNoteImageUrls(DOCUMENT, "board-1", (imageId) =>
      imageId === null ? null : noteImageCacheUrl("board-1", imageId),
    );
    const parsed = JSON.parse(rewritten) as Array<{
      type?: string;
      props?: { url?: string };
      content?: unknown;
    }>;
    expect(parsed[1]?.props?.url).toBe("/api/boards/board-1/images/image-1/cache");
    const nested = parsed[2]?.content as Array<{ props?: { url?: string } }>;
    expect(nested[0]?.props?.url).toBe(
      "/api/boards/board-1/images/image-2/cache",
    );
    // Paragraph blocks are untouched.
    expect(parsed[0]).toEqual(JSON.parse(DOCUMENT)[0]);
  });

  it("canonicalizes cache urls back to /api/images references", () => {
    const hydrated = rewriteNoteImageUrls(DOCUMENT, "board-1", (imageId) =>
      imageId === null ? null : noteImageCacheUrl("board-1", imageId),
    );
    expect(canonicalizeNoteDocument(hydrated, "board-1")).toBe(DOCUMENT);
  });

  it("treats cache-served and canonical documents as equivalent", () => {
    const hydrated = rewriteNoteImageUrls(DOCUMENT, "board-1", (imageId) =>
      imageId === null ? null : noteImageCacheUrl("board-1", imageId),
    );
    expect(noteDocumentsEquivalent(hydrated, DOCUMENT, "board-1")).toBe(true);
    expect(
      noteDocumentsEquivalent(
        DOCUMENT,
        JSON.stringify([{ id: "x", type: "paragraph" }]),
        "board-1",
      ),
    ).toBe(false);
  });
});

describe("note document well-formedness", () => {
  it("accepts empty and block-array documents", () => {
    expect(isWellFormedNoteDocument(null)).toBe(true);
    expect(isWellFormedNoteDocument(undefined)).toBe(true);
    expect(isWellFormedNoteDocument("")).toBe(true);
    expect(isWellFormedNoteDocument("   ")).toBe(true);
    expect(isWellFormedNoteDocument("[]")).toBe(true);
    expect(isWellFormedNoteDocument(DOCUMENT)).toBe(true);
  });

  it("rejects non-empty documents that cannot be parsed or are not arrays", () => {
    expect(isWellFormedNoteDocument("not json")).toBe(false);
    expect(isWellFormedNoteDocument('{"not":"an array"}')).toBe(false);
    expect(isWellFormedNoteDocument('"just a string"')).toBe(false);
  });
});

describe("note document outline", () => {
  const OUTLINE_DOCUMENT = JSON.stringify([
    {
      id: "h1",
      type: "heading",
      props: { level: 1 },
      content: [
        { type: "text", text: "Title" },
        {
          type: "link",
          href: "https://example.com",
          content: [{ type: "text", text: " with link" }],
        },
      ],
    },
    { id: "p1", type: "paragraph", content: [{ type: "text", text: "Body" }] },
    {
      id: "h2",
      type: "heading",
      props: { level: 2 },
      content: [{ type: "text", text: "Section" }],
    },
    {
      id: "h3",
      type: "heading",
      props: { level: 3 },
      content: [],
    },
    {
      id: "h6",
      type: "heading",
      props: { level: 6 },
      content: [{ type: "text", text: "Deep" }],
    },
  ]);

  it("collects top-level headings with their level and full text", () => {
    expect(collectNoteHeadings(OUTLINE_DOCUMENT)).toEqual([
      { id: "h1", level: 1, text: "Title with link" },
      { id: "h2", level: 2, text: "Section" },
      { id: "h3", level: 3, text: "" },
      { id: "h6", level: 6, text: "Deep" },
    ]);
  });

  it("returns an empty outline for malformed or empty documents", () => {
    expect(collectNoteHeadings(null)).toEqual([]);
    expect(collectNoteHeadings("not json")).toEqual([]);
    expect(collectNoteHeadings(JSON.stringify([{ id: "p", type: "paragraph" }]))).toEqual([]);
  });
});
