import { describe, expect, it } from "vitest";

import {
  collectSceneImageIds,
  imageReference,
  imageReferenceId,
  parseSceneDocument,
  referencedFileIds,
  sceneImageReferences,
  serializeWhiteboardScene,
} from "@/lib/whiteboard-scene";

const EMBEDDED = "data:image/png;base64,cG5nLWJ5dGVz";

function file(dataURL: string, extra: Record<string, unknown> = {}) {
  return { id: "file", mimeType: "image/png", dataURL, ...extra };
}

describe("whiteboard scene image references", () => {
  it("recognises only masar image references", () => {
    expect(imageReferenceId(imageReference("abc"))).toBe("abc");
    expect(imageReferenceId("masar://")).toBeNull();
    expect(imageReferenceId("data:image/png;base64,abc")).toBeNull();
    expect(imageReferenceId(undefined)).toBeNull();
  });

  it("serializes stored files as references and keeps new files embedded", () => {
    const snapshot = {
      elements: [
        { id: "old", type: "image", fileId: "old-file" },
        { id: "new", type: "image", fileId: "new-file" },
      ],
      appState: { collaborators: { a: {} }, scrollX: 2 },
      files: {
        "old-file": file(EMBEDDED),
        "new-file": file(EMBEDDED),
      },
    };

    const serialized = serializeWhiteboardScene(
      snapshot,
      new Map([["old-file", "image-1"]]),
    );
    const parsed = JSON.parse(serialized) as {
      appState: Record<string, unknown>;
      files: Record<string, { dataURL: string }>;
    };

    expect(parsed.files["old-file"]?.dataURL).toBe("masar://image-1");
    expect(parsed.files["new-file"]?.dataURL).toBe(EMBEDDED);
    expect(parsed.appState.collaborators).toBeUndefined();
    expect(parsed.appState.scrollX).toBe(2);
  });

  it("drops files that no live element references", () => {
    const snapshot = {
      elements: [
        { id: "kept", type: "image", fileId: "kept" },
        { id: "deleted", type: "image", fileId: "deleted", isDeleted: true },
      ],
      appState: {},
      files: {
        kept: file(EMBEDDED),
        deleted: file(EMBEDDED),
        orphan: file(EMBEDDED),
      },
    };

    const parsed = JSON.parse(
      serializeWhiteboardScene(snapshot, new Map()),
    ) as { files: Record<string, unknown> };
    expect(Object.keys(parsed.files)).toEqual(["kept"]);
  });

  it("collects referenced image ids from a stored scene", () => {
    const scene = JSON.stringify({
      elements: [],
      appState: {},
      files: {
        a: file("masar://image-a"),
        b: file(EMBEDDED),
        c: file("masar://image-c"),
        d: file("masar://image-a"),
      },
    });

    expect(collectSceneImageIds(scene)).toEqual(["image-a", "image-c"]);
    expect([...sceneImageReferences(scene)]).toEqual([
      ["a", "image-a"],
      ["c", "image-c"],
      ["d", "image-a"],
    ]);
    expect(collectSceneImageIds("not json")).toEqual([]);
  });

  it("parses only object scenes and object files", () => {
    expect(parseSceneDocument("{}")?.files).toEqual({});
    expect(parseSceneDocument("[]")).toBeNull();
    expect(parseSceneDocument("not json")).toBeNull();
    expect(
      parseSceneDocument(JSON.stringify({ files: { bad: "string" } }))?.files,
    ).toEqual({});
  });

  it("ignores deleted and malformed elements when finding used files", () => {
    expect(
      [...referencedFileIds([
        { fileId: "a" },
        { fileId: "b", isDeleted: true },
        { fileId: 3 },
        null,
      ])],
    ).toEqual(["a"]);
  });
});
