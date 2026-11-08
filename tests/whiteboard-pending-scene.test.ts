import { beforeEach, describe, expect, it } from "vitest";

import {
  forgetPendingScene,
  pendingSceneCount,
  rememberPendingScene,
  resetPendingScenes,
  takePendingScene,
} from "@/lib/whiteboard-pending-scene";

function scene(dataURL: string): string {
  return JSON.stringify({
    elements: [{ id: "el", type: "image", fileId: "f" }],
    appState: {},
    files: { f: { id: "f", mimeType: "image/png", dataURL, created: 1 } },
  });
}

beforeEach(() => {
  resetPendingScenes();
});

describe("pending scene registry", () => {
  it("hands an unsaved scene to the next mount and clears it on confirm", () => {
    const pending = scene("data:image/png;base64,cG5n");
    rememberPendingScene("board-a", pending);

    expect(takePendingScene("board-a", "{}")).toBe(pending);
    expect(pendingSceneCount()).toBe(1);

    forgetPendingScene("board-a");
    expect(takePendingScene("board-a", "{}")).toBeNull();
    expect(pendingSceneCount()).toBe(0);
  });

  it("treats a scene that already matches the persisted one as saved", () => {
    const saved = scene("masar://img-1");
    rememberPendingScene("board-a", saved);
    expect(takePendingScene("board-a", saved)).toBeNull();
    expect(pendingSceneCount()).toBe(0);
  });

  it("treats content-equal scenes (different references) as saved", () => {
    rememberPendingScene("board-a", scene("masar://img-1"));
    expect(takePendingScene("board-a", scene("masar://img-2"))).toBeNull();
    expect(pendingSceneCount()).toBe(0);
  });

  it("keeps boards independent", () => {
    rememberPendingScene("board-a", scene("data:image/png;base64,YQ"));
    rememberPendingScene("board-b", scene("data:image/png;base64,Yg"));
    expect(takePendingScene("board-a", "{}")).toBe(scene("data:image/png;base64,YQ"));
    expect(takePendingScene("board-b", "{}")).toBe(scene("data:image/png;base64,Yg"));
  });

  it("returns null for boards without a pending scene", () => {
    expect(takePendingScene("missing", "{}")).toBeNull();
  });
});
