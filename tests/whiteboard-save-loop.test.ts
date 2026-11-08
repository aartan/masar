import { describe, expect, it } from "vitest";

import { ClientApiError } from "@/lib/client-api";
import {
  WhiteboardSaveLoop,
  type WhiteboardSaveStatus,
} from "@/lib/whiteboard-save-loop";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let the drain loop process resolved/rejected promises. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

interface Harness {
  loop: WhiteboardSaveLoop;
  saves: string[];
  requests: Map<number, Deferred<string>>;
  statuses: WhiteboardSaveStatus[];
  maxConcurrent: () => number;
}

function harness(): Harness {
  const saves: string[] = [];
  const requests = new Map<number, Deferred<string>>();
  const statuses: WhiteboardSaveStatus[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const loop = new WhiteboardSaveLoop({
    save: (serialized) => {
      saves.push(serialized);
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      const request = deferred<string>();
      requests.set(saves.length - 1, request);
      void request.promise.then(
        () => {
          concurrent -= 1;
        },
        () => {
          concurrent -= 1;
        },
      );
      return request.promise;
    },
    onStatus: (status) => statuses.push(status),
    now: () => 1_000,
  });
  return { loop, saves, requests, statuses, maxConcurrent: () => maxConcurrent };
}

function lastPhase(statuses: WhiteboardSaveStatus[]): string | undefined {
  return statuses[statuses.length - 1]?.phase;
}

describe("WhiteboardSaveLoop", () => {
  it("saves the newest pending state with never more than one request in flight", async () => {
    const { loop, saves, requests, maxConcurrent } = harness();

    loop.change("scene-1");
    loop.flush();
    expect(saves).toEqual(["scene-1"]);

    // A second flush while a save is running is a no-op.
    loop.flush();
    expect(saves).toEqual(["scene-1"]);

    // A newer change is queued, not sent while the first save is in flight.
    loop.change("scene-2");
    expect(saves).toEqual(["scene-1"]);
    expect(loop.saving).toBe(true);
    expect(loop.pendingScene).toBe("scene-2");

    requests.get(0)!.resolve("canonical-1");
    await settle();
    expect(saves).toEqual(["scene-1", "scene-2"]);
    expect(maxConcurrent()).toBe(1);

    requests.get(1)!.resolve("canonical-2");
    await settle();
    expect(loop.pendingScene).toBeNull();
    expect(loop.lastSavedScene).toBe("canonical-2");
  });

  it("tracks the canonical scene returned by the server, not the request body", async () => {
    const { loop, requests, statuses } = harness();

    loop.change("scene-embedded");
    loop.flush();
    requests.get(0)!.resolve("scene-referenced");
    await settle();

    expect(loop.lastSavedScene).toBe("scene-referenced");
    expect(lastPhase(statuses)).toBe("saved");

    // A canvas state equal to the canonical scene is clean.
    loop.change("scene-referenced");
    expect(loop.pendingScene).toBeNull();
    expect(loop.saving).toBe(false);
  });

  it("does not report saved while a newer state is still queued", async () => {
    const { loop, requests, statuses } = harness();

    loop.change("scene-1");
    loop.flush();
    loop.change("scene-2");

    requests.get(0)!.resolve("canonical-1");
    await settle();

    // The first save finished but scene-2 is still queued: no "saved" yet.
    expect(statuses.map((status) => status.phase)).toEqual([
      "saving",
      "saving",
    ]);

    requests.get(1)!.resolve("canonical-2");
    await settle();
    expect(lastPhase(statuses)).toBe("saved");
    expect(loop.pendingScene).toBeNull();
  });

  it("re-persists the current state when an in-flight save stores older content (undo during save)", async () => {
    const { loop, saves, requests } = harness();

    loop.setSavedScene("saved-state");
    loop.change("edited-state");
    loop.flush();
    expect(saves).toEqual(["edited-state"]);

    // The user undoes back to the saved state while the save is in flight.
    loop.change("saved-state");
    expect(loop.pendingScene).toBe("saved-state");

    // The in-flight save commits the older content...
    requests.get(0)!.resolve("canonical-edited");
    await settle();

    // ...so the loop drains the current state to converge the database with
    // the canvas.
    expect(saves).toEqual(["edited-state", "saved-state"]);
    requests.get(1)!.resolve("saved-state");
    await settle();
    expect(loop.pendingScene).toBeNull();
    expect(loop.lastSavedScene).toBe("saved-state");
  });

  it("clears a stale queue when the canvas returns to the saved state", async () => {
    const { loop, saves, requests, statuses } = harness();

    loop.setSavedScene("saved-state");

    // A save failed, leaving the failed content queued.
    loop.change("failed-state");
    loop.flush();
    requests.get(0)!.reject(new ClientApiError("boom", 500));
    await settle();
    expect(loop.pendingScene).toBe("failed-state");

    // The user undoes the change; nothing is pending anymore.
    loop.change("saved-state");
    expect(loop.pendingScene).toBeNull();
    loop.flush();
    expect(saves).toEqual(["failed-state"]); // no new request
    expect(lastPhase(statuses)).toBe("error"); // status is owned by the caller
  });

  it("keeps unsaved content queued on failure and retries it on flush", async () => {
    const { loop, saves, requests, statuses } = harness();

    loop.change("scene-1");
    loop.flush();
    requests.get(0)!.reject(new ClientApiError("save failed", 500));
    await settle();

    expect(lastPhase(statuses)).toBe("error");
    expect(loop.pendingScene).toBe("scene-1");
    expect(loop.saving).toBe(false);

    loop.flush();
    expect(saves).toEqual(["scene-1", "scene-1"]);
    requests.get(1)!.resolve("canonical-1");
    await settle();

    expect(lastPhase(statuses)).toBe("saved");
    expect(loop.pendingScene).toBeNull();
    expect(loop.lastSavedScene).toBe("canonical-1");
  });

  it("reports too_large for 413 responses and keeps the content queued", async () => {
    const { loop, requests, statuses } = harness();

    loop.change("huge-scene");
    loop.flush();
    requests.get(0)!.reject(new ClientApiError("too large", 413));
    await settle();

    expect(statuses[statuses.length - 1]).toEqual({ phase: "too_large" });
    expect(loop.pendingScene).toBe("huge-scene");

    // A smaller scene supersedes the oversized one and saves normally.
    loop.change("small-scene");
    loop.flush();
    requests.get(1)!.resolve("canonical-small");
    await settle();
    expect(lastPhase(statuses)).toBe("saved");
    expect(loop.pendingScene).toBeNull();
  });

  it("never saves a state that already matches the persisted scene", async () => {
    const { loop, saves } = harness();

    loop.setSavedScene("saved-state");
    loop.change("saved-state");
    loop.flush();
    expect(saves).toEqual([]);
    expect(loop.pendingScene).toBeNull();
  });

  it("does not re-save content that differs only in image references", async () => {
    const scene = (dataURL: string) =>
      JSON.stringify({
        elements: [{ id: "el", type: "image", fileId: "f" }],
        appState: {},
        files: {
          f: { id: "f", mimeType: "image/png", dataURL, created: 1 },
        },
      });

    const { loop, saves, statuses } = harness();

    loop.setSavedScene(scene("masar://img-1"));
    // Same canvas, serialized with a different reference (a save captured
    // with stale references). This must not queue another save.
    loop.change(scene("masar://img-2"));
    expect(loop.pendingScene).toBeNull();
    expect(loop.isContentSaved(scene("masar://img-2"))).toBe(true);
    loop.flush();
    expect(saves).toEqual([]);

    // An embedded variant of the same file is the same content too.
    loop.change(scene("data:image/png;base64,cG5n"));
    expect(loop.pendingScene).toBeNull();
    expect(statuses).toEqual([]);
  });

  it("drops a superseded state that matches the stored scene modulo references", async () => {
    const scene = (first: string, second: string) =>
      JSON.stringify({
        elements: [
          { id: "a", type: "image", fileId: "f1" },
          { id: "b", type: "image", fileId: "f2" },
        ],
        appState: {},
        files: {
          f1: { id: "f1", mimeType: "image/png", dataURL: first, created: 1 },
          f2: { id: "f2", mimeType: "image/png", dataURL: second, created: 1 },
        },
      });
    const withExtra = (first: string, second: string) =>
      JSON.stringify({
        elements: [
          { id: "a", type: "image", fileId: "f1" },
          { id: "b", type: "image", fileId: "f2" },
          { id: "extra", type: "rectangle" },
        ],
        appState: {},
        files: {
          f1: { id: "f1", mimeType: "image/png", dataURL: first, created: 1 },
          f2: { id: "f2", mimeType: "image/png", dataURL: second, created: 1 },
        },
      });

    const { loop, saves, requests, statuses } = harness();

    loop.setSavedScene(scene("masar://img-1", "masar://img-2"));
    // A genuine change starts a save...
    loop.change(withExtra("masar://img-1", "masar://img-2"));
    loop.flush();
    expect(saves).toHaveLength(1);

    // ...and while it is in flight the canvas reports content that matches
    // the stored scene again, serialized with a different reference set. This
    // used to ping-pong between reference variants forever.
    loop.change(scene("masar://img-3", "masar://img-4"));

    // The in-flight save stores content equivalent to the queued state.
    requests.get(0)!.resolve(scene("masar://img-5", "masar://img-6"));
    await settle();

    expect(saves).toHaveLength(1);
    expect(loop.pendingScene).toBeNull();
    expect(lastPhase(statuses)).toBe("saved");
  });

  it("still re-persists the canvas when an in-flight save stores genuinely older content", async () => {
    const scene = (files: Record<string, string>) =>
      JSON.stringify({
        elements: Object.keys(files).map((fileId) => ({
          id: `el-${fileId}`,
          type: "image",
          fileId,
        })),
        appState: {},
        files: Object.fromEntries(
          Object.entries(files).map(([fileId, dataURL]) => [
            fileId,
            { id: fileId, mimeType: "image/png", dataURL, created: 1 },
          ]),
        ),
      });

    const { loop, saves, requests } = harness();

    loop.setSavedScene(scene({ f1: "masar://img-1" }));
    // Paste a second image while the first save is in flight.
    loop.change(scene({ f1: "masar://img-1", f2: "masar://img-2" }));
    loop.flush();
    // Undo the paste before the save finishes.
    loop.change(scene({ f1: "masar://img-1" }));

    requests.get(0)!.resolve(scene({ f1: "masar://img-1", f2: "masar://img-2" }));
    await settle();

    // The canvas differs from what the in-flight save stored, so it must be
    // saved again to converge the database with the canvas.
    expect(saves).toHaveLength(2);
    expect(saves[1]).toBe(scene({ f1: "masar://img-1" }));
    requests.get(1)!.resolve(scene({ f1: "masar://img-1" }));
    await settle();
    expect(loop.pendingScene).toBeNull();
    expect(loop.lastSavedScene).toBe(scene({ f1: "masar://img-1" }));
  });
});
