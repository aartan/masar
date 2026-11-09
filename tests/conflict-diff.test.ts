import { describe, expect, it } from "vitest";

import {
  buildConflictDiff,
  diffText,
  type ConflictLookup,
} from "@/lib/conflict-diff";
import type { SyncConflictView } from "@/lib/types";

const lookup: ConflictLookup = {
  columns: new Map([
    ["todo", "To Do"],
    ["done", "Done"],
  ]),
  labels: new Map([["label-1", "Design"]]),
  projects: new Map([["project-1", "Website"]]),
};

function conflict(overrides: Partial<SyncConflictView> = {}): SyncConflictView {
  const now = new Date("2026-06-01T10:00:00.000Z").toISOString();
  return {
    id: "conflict-1",
    entityType: "task",
    entityId: "task-1",
    incomingDeleted: false,
    incomingData: {
      id: "task-1",
      board_id: "board-1",
      column_id: "done",
      title: "Write release notes",
      description: "Local description",
      priority: "high",
      due_date: "2026-06-12",
      completed_at: 1_780_000_000_000,
      position: 2,
      updated_at: 1_780_000_000_000,
    },
    incomingUpdatedAt: now,
    winningDeleted: false,
    winningData: {
      id: "task-1",
      board_id: "board-1",
      column_id: "todo",
      title: "Write release notes",
      description: "Cloud description",
      priority: "low",
      due_date: "2026-06-10",
      completed_at: null,
      position: 1,
      updated_at: 1_779_000_000_000,
    },
    winningUpdatedAt: now,
    revision: 4,
    createdAt: now,
    projectId: "project-1",
    projectName: "Website",
    boardId: "board-1",
    boardName: "Launch",
    entityLabel: "Write release notes",
    ...overrides,
  };
}

describe("conflict diff", () => {
  it("shows useful field-level changes for a task", () => {
    const diff = buildConflictDiff(conflict(), lookup);
    const changed = new Map(diff.changed.map((row) => [row.key, row]));

    expect(changed.get("column_id")).toMatchObject({
      label: "Column",
      local: "Done",
      cloud: "To Do",
    });
    expect(changed.get("priority")).toMatchObject({
      label: "Priority",
      local: "High",
      cloud: "Low",
    });
    expect(changed.get("due_date")).toMatchObject({
      local: "Jun 12, 2026",
      cloud: "Jun 10, 2026",
    });
    expect(changed.get("description")?.longText).toEqual({
      local: "Local description",
      cloud: "Cloud description",
    });
    expect(changed.has("title")).toBe(false);
    expect(diff.unchanged.some((row) => row.key === "title")).toBe(true);
    expect(diff.changed.some((row) => row.key === "updated_at")).toBe(false);
    expect(diff.summary).toContain("Column");
    expect(diff.summary).toContain("Priority");
  });

  it("shows deletion versus existence", () => {
    const diff = buildConflictDiff(
      conflict({
        incomingDeleted: true,
        incomingData: {},
      }),
      lookup,
    );
    expect(diff.changed[0]).toMatchObject({
      key: "existence",
      local: "Deleted",
      cloud: "Present",
    });
  });

  it("summarizes whiteboard element changes", () => {
    const cloudScene = JSON.stringify({
      elements: [
        { id: "removed", version: 1 },
        { id: "shared", version: 2 },
      ],
    });
    const localScene = JSON.stringify({
      elements: [
        { id: "shared", version: 3 },
        { id: "added", version: 1 },
      ],
    });
    const diff = buildConflictDiff(
      conflict({
        entityType: "whiteboard",
        incomingData: { id: "board-1", board_id: "board-1", scene: localScene },
        winningData: { id: "board-1", board_id: "board-1", scene: cloudScene },
      }),
      lookup,
    );
    expect(diff.whiteboard).toEqual({
      cloudElements: 2,
      localElements: 2,
      added: 1,
      removed: 1,
      modified: 1,
    });
    expect(diff.summary).toBe("1 added · 1 removed · 1 modified");
  });

  it("compares task image metadata without rendering the URL", () => {
    const diff = buildConflictDiff(
      conflict({
        entityType: "task_image",
        incomingData: {
          id: "image-1",
          task_id: "task-1",
          url: `data:image/png;base64,${"A".repeat(1000)}`,
          name: "shot.png",
          position: 0,
        },
        winningData: {
          id: "image-1",
          task_id: "task-1",
          url: "/api/images/image-1",
          name: "renamed.png",
          position: 2,
        },
        entityLabel: "shot.png",
      }),
      lookup,
    );

    const changed = new Map(diff.changed.map((row) => [row.key, row]));
    expect(changed.get("name")).toMatchObject({
      label: "File name",
      local: "shot.png",
      cloud: "renamed.png",
    });
    expect(changed.get("position")).toMatchObject({
      label: "Order",
      local: "#1",
      cloud: "#3",
    });
    expect(
      [...diff.changed, ...diff.unchanged].some((row) => row.key === "url"),
    ).toBe(false);
    expect(diff.summary).toBe("Changed: File name, Order");
  });

  it("builds a line diff for long text", () => {
    const lines = diffText("First line\nSecond line", "First line\nUpdated line");
    expect(lines).toEqual([
      { kind: "equal", text: "First line" },
      { kind: "removed", text: "Second line" },
      { kind: "added", text: "Updated line" },
    ]);
  });
});
