import { describe, expect, it } from "vitest";

import {
  collectSceneImageIds,
  imageReference,
  imageReferenceId,
  parseSceneDocument,
  referencedFileIds,
  sameSceneContent,
  sceneImageReferences,
  serializeWhiteboardScene,
  whiteboardSceneAppState,
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
    expect(parsed.appState).toEqual({});
  });

  it("persists only scene-owned app state", () => {
    const serialized = serializeWhiteboardScene(
      {
        elements: [],
        appState: {
          collaborators: { a: {} },
          width: 1280,
          height: 720,
          offsetLeft: 10,
          offsetTop: 20,
          scrollX: 2,
          scrollY: 3,
          zoom: { value: 2 },
          selectedElementIds: { a: true },
          activeTool: { type: "hand" },
          viewModeEnabled: true,
          theme: "dark",
          viewBackgroundColor: "#ffffff",
          gridSize: 20,
          gridStep: 5,
          gridModeEnabled: true,
        },
        files: {},
      },
      new Map(),
    );

    expect((JSON.parse(serialized) as { appState: unknown }).appState).toEqual({
      viewBackgroundColor: "#ffffff",
      gridSize: 20,
      gridStep: 5,
      gridModeEnabled: true,
    });
  });

  it("projects malformed app state to an empty object", () => {
    expect(whiteboardSceneAppState(null)).toEqual({});
    expect(whiteboardSceneAppState([])).toEqual({});
    expect(whiteboardSceneAppState("not an object")).toEqual({});
    expect(
      whiteboardSceneAppState({
        width: 1,
        scrollX: 2,
        gridModeEnabled: true,
      }),
    ).toEqual({ gridModeEnabled: true });
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

describe("sameSceneContent", () => {
  function scene(files: Record<string, string>, elements: unknown[] = []) {
    return JSON.stringify({
      elements,
      appState: { scrollX: 1 },
      files: Object.fromEntries(
        Object.entries(files).map(([fileId, dataURL]) => [
          fileId,
          { id: fileId, mimeType: "image/png", dataURL, created: 1 },
        ]),
      ),
    });
  }

  const ELEMENTS = [{ id: "el", type: "image", fileId: "a" }];

  it("treats scenes with different image reference ids as the same content", () => {
    expect(
      sameSceneContent(
        scene({ a: "masar://img-1" }, ELEMENTS),
        scene({ a: "masar://img-2" }, ELEMENTS),
      ),
    ).toBe(true);
  });

  it("treats an embedded file and a stored reference as the same content", () => {
    expect(
      sameSceneContent(
        scene({ a: "data:image/png;base64,cG5n" }, ELEMENTS),
        scene({ a: "masar://img-2" }, ELEMENTS),
      ),
    ).toBe(true);
  });

  it("distinguishes scenes with different file sets", () => {
    expect(
      sameSceneContent(
        scene({ a: "masar://img-1" }, ELEMENTS),
        scene({ a: "masar://img-1", b: "masar://img-2" }, ELEMENTS),
      ),
    ).toBe(false);
  });

  it("distinguishes scenes with different elements or scene app state", () => {
    const base = scene({ a: "masar://img-1" }, ELEMENTS);
    const moved = scene({ a: "masar://img-2" }, [
      { id: "el", type: "image", fileId: "a", x: 10 },
    ]);
    expect(sameSceneContent(base, moved)).toBe(false);

    const otherState = JSON.stringify({
      elements: ELEMENTS,
      appState: { scrollX: 1, viewBackgroundColor: "#ff0000" },
      files: { a: { id: "a", mimeType: "image/png", dataURL: "masar://img-2", created: 1 } },
    });
    expect(sameSceneContent(base, otherState)).toBe(false);
  });

  it("ignores viewport-only app state differences", () => {
    const base = scene({ a: "masar://img-1" }, ELEMENTS);
    const panned = JSON.stringify({
      elements: ELEMENTS,
      appState: {
        scrollX: 400,
        scrollY: 250,
        zoom: { value: 2 },
        width: 800,
        height: 600,
      },
      files: { a: { id: "a", mimeType: "image/png", dataURL: "masar://img-2", created: 1 } },
    });
    expect(sameSceneContent(base, panned)).toBe(true);
  });

  it("distinguishes scenes with different file metadata", () => {
    const first = scene({ a: "masar://img-1" }, ELEMENTS);
    const second = JSON.stringify({
      elements: ELEMENTS,
      appState: { scrollX: 1 },
      files: { a: { id: "a", mimeType: "image/jpeg", dataURL: "masar://img-2", created: 1 } },
    });
    expect(sameSceneContent(first, second)).toBe(false);
  });

  it("falls back to strict inequality for malformed scenes", () => {
    expect(sameSceneContent("not json", "not json")).toBe(true);
    expect(sameSceneContent("not json", "other")).toBe(false);
    expect(sameSceneContent("{}", "{\"elements\":\"nope\"}")).toBe(false);
  });
});
