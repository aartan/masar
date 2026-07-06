import { describe, expect, it } from "vitest";

import type { BoardColumn, Task } from "@/lib/types";
import {
  buildTaskOrderPayload,
  completionPercent,
  EMPTY_FILTERS,
  filterAndSortTasks,
  getFilteredColumnTasks,
  getOrderedTasks,
  groupTasksByColumn,
  hasActiveFilters,
  matchesFilters,
  moveColumn,
  moveTaskToColumnEnd,
  moveTaskToIndex,
  sortTasks,
  type TaskFilters,
} from "@/lib/task-utils";

const BOARD_ID = "board-1";

function task(overrides: Partial<Task> & Pick<Task, "id">): Task {
  return {
    boardId: BOARD_ID,
    columnId: "todo",
    title: `Task ${overrides.id}`,
    description: null,
    priority: "none",
    dueDate: null,
    assignee: null,
    position: 0,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    labelIds: [],
    subtaskCount: 0,
    subtaskDoneCount: 0,
    commentCount: 0,
    ...overrides,
  };
}

function column(
  id: string,
  position: number,
  overrides: Partial<BoardColumn> = {},
): BoardColumn {
  return {
    id,
    boardId: BOARD_ID,
    name: id,
    position,
    isDone: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const filters = (overrides: Partial<TaskFilters> = {}): TaskFilters => ({
  ...EMPTY_FILTERS,
  ...overrides,
});

describe("getOrderedTasks", () => {
  it("orders by position, then creation time, then id", () => {
    const tasks = [
      task({ id: "b", position: 1 }),
      task({ id: "a", position: 1, createdAt: "2025-12-31T00:00:00.000Z" }),
      task({ id: "c", position: 0 }),
    ];

    expect(getOrderedTasks(tasks, "todo").map((item) => item.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("only returns tasks in the requested column and does not mutate input", () => {
    const tasks = [
      task({ id: "a", position: 1 }),
      task({ id: "b", position: 0 }),
      task({ id: "c", columnId: "done" }),
    ];
    const before = tasks.map((item) => item.id);

    expect(getOrderedTasks(tasks, "todo").map((item) => item.id)).toEqual([
      "b",
      "a",
    ]);
    expect(tasks.map((item) => item.id)).toEqual(before);
  });
});

describe("groupTasksByColumn", () => {
  it("returns an entry for every column, including empty ones", () => {
    const grouped = groupTasksByColumn(
      [task({ id: "a" }), task({ id: "b", columnId: "done" })],
      [column("todo", 0), column("done", 1), column("empty", 2)],
    );

    expect(grouped.todo?.map((item) => item.id)).toEqual(["a"]);
    expect(grouped.done?.map((item) => item.id)).toEqual(["b"]);
    expect(grouped.empty).toEqual([]);
  });
});

describe("moveTaskToIndex", () => {
  it("moves a task within a column and normalizes positions", () => {
    const tasks = [
      task({ id: "a", position: 0 }),
      task({ id: "b", position: 1 }),
      task({ id: "c", position: 2 }),
    ];

    const result = moveTaskToIndex(tasks, "c", "todo", 0);

    expect(result.map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(result.map((item) => item.position)).toEqual([0, 1, 2]);
    // Source array is untouched.
    expect(tasks.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("moves a task to another column at the requested index", () => {
    const tasks = [
      task({ id: "a", columnId: "todo", position: 0 }),
      task({ id: "b", columnId: "done", position: 0 }),
      task({ id: "c", columnId: "done", position: 1 }),
    ];

    const result = moveTaskToIndex(tasks, "a", "done", 1);

    expect(getOrderedTasks(result, "todo")).toEqual([]);
    expect(getOrderedTasks(result, "done").map((item) => item.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(result.find((item) => item.id === "a")?.columnId).toBe("done");
    expect(getOrderedTasks(result, "done").map((item) => item.position)).toEqual([
      0, 1, 2,
    ]);
  });

  it("clamps out-of-range target indexes", () => {
    const tasks = [task({ id: "a", position: 0 })];
    const result = moveTaskToIndex(tasks, "a", "todo", 99);
    expect(result[0]?.position).toBe(0);
  });

  it("returns the same array when the task does not exist", () => {
    const tasks = [task({ id: "a" })];
    expect(moveTaskToIndex(tasks, "missing", "todo", 0)).toBe(tasks);
  });
});

describe("moveTaskToColumnEnd", () => {
  it("appends after the last task in the target column", () => {
    const tasks = [
      task({ id: "a", columnId: "todo", position: 0 }),
      task({ id: "b", columnId: "done", position: 0 }),
      task({ id: "c", columnId: "done", position: 1 }),
    ];
    const result = moveTaskToColumnEnd(tasks, "a", "done");
    expect(getOrderedTasks(result, "done").map((item) => item.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });
});

describe("buildTaskOrderPayload", () => {
  it("includes every column with its ordered task ids", () => {
    const payload = buildTaskOrderPayload(
      [
        task({ id: "a", columnId: "todo", position: 1 }),
        task({ id: "b", columnId: "todo", position: 0 }),
        task({ id: "c", columnId: "done", position: 0 }),
      ],
      [column("todo", 0), column("done", 1), column("empty", 2)],
    );

    expect(payload).toEqual({
      columns: [
        { columnId: "todo", taskIds: ["b", "a"] },
        { columnId: "done", taskIds: ["c"] },
        { columnId: "empty", taskIds: [] },
      ],
    });
  });
});

describe("moveColumn", () => {
  const columns = [column("a", 0), column("b", 1), column("c", 2)];

  it("moves a column and renumbers positions", () => {
    const result = moveColumn(columns, "c", "a");
    expect(result.map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(result.map((item) => item.position)).toEqual([0, 1, 2]);
    expect(columns.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("returns the original list for unknown or identical ids", () => {
    expect(moveColumn(columns, "a", "a")).toBe(columns);
    expect(moveColumn(columns, "missing", "a")).toBe(columns);
  });
});

describe("hasActiveFilters", () => {
  it("is false for empty filters", () => {
    expect(hasActiveFilters(filters())).toBe(false);
    expect(hasActiveFilters(filters({ query: "   " }))).toBe(false);
  });

  it("detects each filter type", () => {
    expect(hasActiveFilters(filters({ query: "x" }))).toBe(true);
    expect(hasActiveFilters(filters({ priorities: ["high"] }))).toBe(true);
    expect(hasActiveFilters(filters({ labelIds: ["l1"] }))).toBe(true);
    expect(hasActiveFilters(filters({ due: "today" }))).toBe(true);
    expect(hasActiveFilters(filters({ columnId: "todo" }))).toBe(true);
  });

  it("does not treat sorting as a filter", () => {
    expect(hasActiveFilters(filters({ sort: "due" }))).toBe(false);
  });
});

describe("matchesFilters", () => {
  const reference = "2026-06-15";

  it("matches search text against title and description, case-insensitively", () => {
    const item = task({ id: "a", title: "Ship launch", description: "Write notes" });
    expect(matchesFilters(item, filters({ query: "LAUNCH" }), reference)).toBe(true);
    expect(matchesFilters(item, filters({ query: "notes" }), reference)).toBe(true);
    expect(matchesFilters(item, filters({ query: "missing" }), reference)).toBe(false);
  });

  it("matches any of the selected priorities", () => {
    const item = task({ id: "a", priority: "high" });
    expect(
      matchesFilters(item, filters({ priorities: ["urgent", "high"] }), reference),
    ).toBe(true);
    expect(
      matchesFilters(item, filters({ priorities: ["low"] }), reference),
    ).toBe(false);
  });

  it("matches tasks containing at least one selected label", () => {
    const item = task({ id: "a", labelIds: ["design", "eng"] });
    expect(
      matchesFilters(item, filters({ labelIds: ["design"] }), reference),
    ).toBe(true);
    expect(
      matchesFilters(item, filters({ labelIds: ["design", "ops"] }), reference),
    ).toBe(true);
    expect(
      matchesFilters(item, filters({ labelIds: ["ops"] }), reference),
    ).toBe(false);
  });

  it("filters by column", () => {
    const item = task({ id: "a", columnId: "todo" });
    expect(matchesFilters(item, filters({ columnId: "todo" }), reference)).toBe(true);
    expect(matchesFilters(item, filters({ columnId: "done" }), reference)).toBe(false);
  });

  it("handles overdue, today, week, and no-due-date filters", () => {
    const overdue = task({ id: "a", dueDate: "2026-06-14" });
    const today = task({ id: "b", dueDate: "2026-06-15" });
    const inWeek = task({ id: "c", dueDate: "2026-06-22" });
    const later = task({ id: "d", dueDate: "2026-06-23" });
    const none = task({ id: "e", dueDate: null });

    expect(matchesFilters(overdue, filters({ due: "overdue" }), reference)).toBe(true);
    expect(matchesFilters(today, filters({ due: "overdue" }), reference)).toBe(false);
    expect(matchesFilters(today, filters({ due: "today" }), reference)).toBe(true);
    expect(matchesFilters(inWeek, filters({ due: "week" }), reference)).toBe(true);
    expect(matchesFilters(later, filters({ due: "week" }), reference)).toBe(false);
    expect(matchesFilters(none, filters({ due: "none" }), reference)).toBe(true);
    expect(matchesFilters(today, filters({ due: "none" }), reference)).toBe(false);
  });
});

describe("sortTasks", () => {
  const tasks = [
    task({ id: "a", priority: "low", dueDate: "2026-06-20", createdAt: "2026-01-01T00:00:00.000Z", position: 2 }),
    task({ id: "b", priority: "urgent", dueDate: null, createdAt: "2026-03-01T00:00:00.000Z", position: 0 }),
    task({ id: "c", priority: "high", dueDate: "2026-06-15", createdAt: "2026-02-01T00:00:00.000Z", position: 1 }),
  ];

  it("sorts by due date with undated tasks last", () => {
    expect(sortTasks(tasks, "due").map((item) => item.id)).toEqual(["c", "a", "b"]);
  });

  it("sorts by priority rank and uses due date as a tiebreak", () => {
    expect(sortTasks(tasks, "priority").map((item) => item.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts newest first", () => {
    expect(sortTasks(tasks, "newest").map((item) => item.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts manually by position", () => {
    expect(sortTasks(tasks, "manual").map((item) => item.id)).toEqual(["b", "c", "a"]);
  });
});

describe("filterAndSortTasks and getFilteredColumnTasks", () => {
  const tasks = [
    task({ id: "a", columnId: "todo", priority: "high", position: 0 }),
    task({ id: "b", columnId: "todo", priority: "low", position: 1 }),
    task({ id: "c", columnId: "done", priority: "high", position: 0 }),
  ];

  it("filters and sorts across the whole board", () => {
    const result = filterAndSortTasks(
      tasks,
      filters({ priorities: ["high"], sort: "manual" }),
      "2026-06-15",
    );
    expect(result.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("filters within a single column", () => {
    const result = getFilteredColumnTasks(
      tasks,
      "todo",
      filters({ priorities: ["high"] }),
      "2026-06-15",
    );
    expect(result.map((item) => item.id)).toEqual(["a"]);
  });
});

describe("completionPercent", () => {
  it("rounds and guards against empty boards", () => {
    expect(completionPercent(0, 0)).toBe(0);
    expect(completionPercent(1, 3)).toBe(33);
    expect(completionPercent(2, 3)).toBe(67);
    expect(completionPercent(3, 3)).toBe(100);
  });
});
