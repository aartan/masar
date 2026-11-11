import { describe, expect, it } from "vitest";

import { ClientApiError } from "@/lib/client-api";
import {
  NoteSaveLoop,
  type NoteSaveResult,
  type NoteSaveStatus,
} from "@/lib/note-save-loop";

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
  loop: NoteSaveLoop;
  saves: Array<{ boardId: string; serialized: string }>;
  requests: Map<number, Deferred<NoteSaveResult>>;
  statuses: NoteSaveStatus[];
  maxConcurrent: () => number;
}

function harness(boardId = "board-1"): Harness {
  const saves: Array<{ boardId: string; serialized: string }> = [];
  const requests = new Map<number, Deferred<NoteSaveResult>>();
  const statuses: NoteSaveStatus[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const loop = new NoteSaveLoop({
    boardId,
    save: (saveBoardId, serialized) => {
      saves.push({ boardId: saveBoardId, serialized });
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      const request = deferred<NoteSaveResult>();
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

function lastPhase(statuses: NoteSaveStatus[]): string | undefined {
  return statuses[statuses.length - 1]?.phase;
}

describe("NoteSaveLoop", () => {
  it("saves the newest pending state with never more than one request in flight", async () => {
    const { loop, saves, requests, maxConcurrent } = harness();

    loop.change("doc-1");
    loop.flush();
    expect(saves).toEqual([{ boardId: "board-1", serialized: "doc-1" }]);

    loop.flush();
    expect(saves).toHaveLength(1);

    loop.change("doc-2");
    expect(saves).toHaveLength(1);
    expect(loop.saving).toBe(true);
    expect(loop.pendingDocument).toBe("doc-2");

    requests.get(0)!.resolve({ document: "doc-1", updatedAt: "t1" });
    await settle();
    expect(saves).toEqual([
      { boardId: "board-1", serialized: "doc-1" },
      { boardId: "board-1", serialized: "doc-2" },
    ]);
    expect(maxConcurrent()).toBe(1);

    requests.get(1)!.resolve({ document: "doc-2", updatedAt: "t2" });
    await settle();
    expect(loop.pendingDocument).toBeNull();
    expect(loop.lastSavedDocument).toBe("doc-2");
    expect(loop.savedUpdatedAt).toBe("t2");
  });

  it("captures the board id for every save, including queued work", async () => {
    const { loop, saves, requests } = harness("board-a");

    loop.change("first");
    loop.flush();
    loop.change("second");
    requests.get(0)!.resolve({ document: "first", updatedAt: "t1" });
    await settle();
    requests.get(1)!.resolve({ document: "second", updatedAt: "t2" });
    await settle();

    for (const save of saves) {
      expect(save.boardId).toBe("board-a");
    }
  });

  it("never mutates another board's captured id when saves overlap a board switch", async () => {
    // Simulates two loops living side by side during a board switch: the
    // first loop's in-flight save must keep writing to its own board.
    const first = harness("board-a");
    const second = harness("board-b");

    first.loop.change("doc-a");
    first.loop.flush();
    second.loop.change("doc-b");
    second.loop.flush();

    first.requests.get(0)!.resolve({ document: "doc-a", updatedAt: "t1" });
    second.requests.get(0)!.resolve({ document: "doc-b", updatedAt: "t2" });
    await settle();

    expect(first.saves).toEqual([{ boardId: "board-a", serialized: "doc-a" }]);
    expect(second.saves).toEqual([{ boardId: "board-b", serialized: "doc-b" }]);
    expect(first.loop.lastSavedDocument).toBe("doc-a");
    expect(second.loop.lastSavedDocument).toBe("doc-b");
  });

  it("stops emitting status after dispose but drains queued work silently", async () => {
    const { loop, saves, requests, statuses } = harness();

    loop.change("doc-1");
    loop.flush();
    loop.change("doc-2");

    loop.dispose();

    // The queued save for doc-2 was recorded before dispose; the drain keeps
    // persisting it after dispose but must not emit further status.
    expect(saves).toHaveLength(1);
    requests.get(0)!.resolve({ document: "doc-1", updatedAt: "t1" });
    await settle();

    expect(saves).toEqual([
      { boardId: "board-1", serialized: "doc-1" },
      { boardId: "board-1", serialized: "doc-2" },
    ]);
    requests.get(1)!.resolve({ document: "doc-2", updatedAt: "t2" });
    await settle();
    expect(lastPhase(statuses)).toBe("saving");
  });

  it("rejects flushes after dispose", async () => {
    const { loop, saves, requests } = harness();

    loop.change("doc-1");
    loop.flush();
    loop.dispose();

    // A change recorded after dispose is not persisted by flush.
    loop.change("doc-2");
    loop.flush();
    expect(saves).toHaveLength(1);

    requests.get(0)!.resolve({ document: "doc-1", updatedAt: "t1" });
    await settle();
    expect(saves).toHaveLength(1);
  });

  it("keeps unsaved content queued on failure and retries it on flush", async () => {
    const { loop, saves, requests, statuses } = harness();

    loop.change("doc-1");
    loop.flush();
    requests.get(0)!.reject(new ClientApiError("save failed", 500));
    await settle();

    expect(lastPhase(statuses)).toBe("error");
    expect(loop.pendingDocument).toBe("doc-1");
    expect(loop.saving).toBe(false);

    loop.flush();
    expect(saves).toHaveLength(2);
    requests.get(1)!.resolve({ document: "doc-1", updatedAt: "t1" });
    await settle();

    expect(lastPhase(statuses)).toBe("saved");
    expect(loop.pendingDocument).toBeNull();
    expect(loop.lastSavedDocument).toBe("doc-1");
  });

  it("reports too_large for 413 responses and keeps the content queued", async () => {
    const { loop, requests, statuses } = harness();

    loop.change("huge-doc");
    loop.flush();
    requests.get(0)!.reject(new ClientApiError("too large", 413));
    await settle();

    expect(statuses[statuses.length - 1]).toEqual({ phase: "too_large" });
    expect(loop.pendingDocument).toBe("huge-doc");
  });

  it("never saves a state that already matches the persisted document", async () => {
    const { loop, saves } = harness();

    loop.setSavedDocument("saved-doc", "t0");
    expect(loop.savedUpdatedAt).toBe("t0");
    loop.change("saved-doc");
    loop.flush();
    expect(saves).toEqual([]);
    expect(loop.pendingDocument).toBeNull();
  });

  it("adopts documents through setSavedDocument and keeps the revision", async () => {
    const { loop } = harness();

    loop.setSavedDocument("remote-doc", "t9");
    expect(loop.lastSavedDocument).toBe("remote-doc");
    expect(loop.savedUpdatedAt).toBe("t9");
    expect(loop.isContentSaved("remote-doc")).toBe(true);
  });

  it("does not re-save content that differs only in image serving URLs", async () => {
    const withImage = (url: string) =>
      JSON.stringify([
        {
          id: "block-1",
          type: "image",
          props: { url },
        },
      ]);

    const saves: string[] = [];
    const loop = new NoteSaveLoop({
      boardId: "board-1",
      save: async (_boardId, serialized) => {
        saves.push(serialized);
        return { document: serialized, updatedAt: "t" };
      },
      onStatus: () => undefined,
      // Stand-in for noteDocumentsEquivalent: content that differs only in
      // how the image is served counts as already saved.
      isEquivalent: (a, b) =>
        a === b ||
        a.replace("/api/boards/board-1/images/img-1/cache", "/api/images/img-1") ===
          b.replace(
            "/api/boards/board-1/images/img-1/cache",
            "/api/images/img-1",
          ),
    });

    loop.setSavedDocument(withImage("/api/images/img-1"));
    loop.change(withImage("/api/boards/board-1/images/img-1/cache"));
    loop.flush();
    await settle();
    expect(saves).toEqual([]);
    expect(loop.pendingDocument).toBeNull();
  });

  it("still re-persists the document when an in-flight save stores older content", async () => {
    const { loop, saves, requests } = harness();

    loop.setSavedDocument("saved");
    loop.change("edited");
    loop.flush();
    expect(saves).toEqual([{ boardId: "board-1", serialized: "edited" }]);

    // Undo while the save is in flight.
    loop.change("saved");
    expect(loop.pendingDocument).toBe("saved");

    requests.get(0)!.resolve({ document: "edited", updatedAt: "t1" });
    await settle();

    expect(saves).toEqual([
      { boardId: "board-1", serialized: "edited" },
      { boardId: "board-1", serialized: "saved" },
    ]);
    requests.get(1)!.resolve({ document: "saved", updatedAt: "t2" });
    await settle();
    expect(loop.pendingDocument).toBeNull();
    expect(loop.lastSavedDocument).toBe("saved");
  });

  it("does not report saved while a newer state is still queued", async () => {
    const { loop, requests, statuses } = harness();

    loop.change("doc-1");
    loop.flush();
    loop.change("doc-2");

    requests.get(0)!.resolve({ document: "doc-1", updatedAt: "t1" });
    await settle();
    expect(statuses.map((status) => status.phase)).toEqual([
      "saving",
      "saving",
    ]);

    requests.get(1)!.resolve({ document: "doc-2", updatedAt: "t2" });
    await settle();
    expect(lastPhase(statuses)).toBe("saved");
  });
});
