import { describe, expect, it } from "vitest";

import {
  boardCreateSchema,
  boardUpdateSchema,
  columnCreateSchema,
  columnUpdateSchema,
  commentCreateSchema,
  dateOnlySchema,
  labelCreateSchema,
  labelUpdateSchema,
  reorderColumnsSchema,
  reorderTasksSchema,
  searchQuerySchema,
  subtaskCreateSchema,
  subtaskUpdateSchema,
  taskCreateSchema,
  taskQuerySchema,
  taskUpdateSchema,
} from "@/lib/validation";

describe("dateOnlySchema", () => {
  it("accepts real ISO dates, including leap days", () => {
    expect(dateOnlySchema.parse("2026-06-15")).toBe("2026-06-15");
    expect(dateOnlySchema.parse("2028-02-29")).toBe("2028-02-29");
  });

  it("rejects malformed and impossible dates", () => {
    expect(dateOnlySchema.safeParse("2026-02-30").success).toBe(false);
    expect(dateOnlySchema.safeParse("2026-6-1").success).toBe(false);
    expect(dateOnlySchema.safeParse("not-a-date").success).toBe(false);
  });
});

describe("board schemas", () => {
  it("trims names and accepts optional fields", () => {
    expect(
      boardCreateSchema.parse({ name: "  Launch  ", description: "  Ship it  " }),
    ).toEqual({ name: "Launch", description: "Ship it" });
  });

  it("rejects empty or overlong names", () => {
    expect(boardCreateSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(boardCreateSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });

  it("rejects empty updates", () => {
    expect(boardUpdateSchema.safeParse({}).success).toBe(false);
    expect(boardUpdateSchema.safeParse({ name: "New" }).success).toBe(true);
  });
});

describe("column schemas", () => {
  it("accepts a completion flag", () => {
    expect(columnCreateSchema.parse({ name: "Done", isDone: true })).toEqual({
      name: "Done",
      isDone: true,
    });
  });

  it("rejects empty updates", () => {
    expect(columnUpdateSchema.safeParse({}).success).toBe(false);
    expect(columnUpdateSchema.safeParse({ isDone: false }).success).toBe(true);
  });

  it("requires a non-empty reorder payload", () => {
    expect(reorderColumnsSchema.safeParse({ columnIds: [] }).success).toBe(false);
    expect(
      reorderColumnsSchema.safeParse({ columnIds: ["a", "b"] }).success,
    ).toBe(true);
  });
});

describe("task schemas", () => {
  it("accepts a minimal task and trims its title", () => {
    expect(
      taskCreateSchema.parse({ columnId: "col-1", title: "  Ship  " }),
    ).toEqual({ columnId: "col-1", title: "Ship" });
  });

  it("rejects missing columns and invalid priorities", () => {
    expect(taskCreateSchema.safeParse({ title: "Ship" }).success).toBe(false);
    expect(
      taskCreateSchema.safeParse({
        columnId: "col-1",
        title: "Ship",
        priority: "someday",
      }).success,
    ).toBe(false);
  });

  it("allows clearing nullable fields on update", () => {
    expect(
      taskUpdateSchema.parse({
        dueDate: null,
        assignee: null,
        description: null,
      }),
    ).toEqual({ dueDate: null, assignee: null, description: null });
  });

  it("rejects empty updates and invalid due dates", () => {
    expect(taskUpdateSchema.safeParse({}).success).toBe(false);
    expect(
      taskUpdateSchema.safeParse({ dueDate: "2026-02-30" }).success,
    ).toBe(false);
  });

  it("validates reorder payload shapes", () => {
    expect(
      reorderTasksSchema.safeParse({
        columns: [{ columnId: "col-1", taskIds: ["task-1", "task-2"] }],
      }).success,
    ).toBe(true);
    expect(
      reorderTasksSchema.safeParse({ columns: [] }).success,
    ).toBe(false);
  });

  it("parses query strings with optional filters", () => {
    expect(taskQuerySchema.parse({})).toEqual({});
    expect(
      taskQuerySchema.parse({
        q: "  launch  ",
        priority: "high",
        due: "overdue",
        sort: "due",
      }),
    ).toEqual({ q: "launch", priority: "high", due: "overdue", sort: "due" });
    expect(taskQuerySchema.safeParse({ priority: "someday" }).success).toBe(false);
  });
});

describe("subtask and comment schemas", () => {
  it("validates subtask creation and updates", () => {
    expect(subtaskCreateSchema.parse({ title: "  Write copy  " })).toEqual({
      title: "Write copy",
    });
    expect(subtaskCreateSchema.safeParse({ title: "" }).success).toBe(false);
    expect(subtaskUpdateSchema.parse({ completed: true })).toEqual({
      completed: true,
    });
    expect(subtaskUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("requires non-empty comments and trims the body", () => {
    expect(commentCreateSchema.parse({ body: "  Looks good  " })).toEqual({
      body: "Looks good",
    });
    expect(commentCreateSchema.safeParse({ body: "   " }).success).toBe(false);
  });
});

describe("label schemas", () => {
  it("accepts known colors and rejects unknown ones", () => {
    expect(
      labelCreateSchema.parse({ name: "Design", color: "violet" }),
    ).toEqual({ name: "Design", color: "violet" });
    expect(
      labelCreateSchema.safeParse({ name: "Design", color: "neon" }).success,
    ).toBe(false);
  });

  it("rejects empty label updates", () => {
    expect(labelUpdateSchema.safeParse({}).success).toBe(false);
    expect(labelUpdateSchema.safeParse({ name: "Ops" }).success).toBe(true);
  });
});

describe("searchQuerySchema", () => {
  it("requires a non-empty trimmed query", () => {
    expect(searchQuerySchema.parse({ q: "  launch  " })).toEqual({ q: "launch" });
    expect(searchQuerySchema.safeParse({ q: "  " }).success).toBe(false);
    expect(searchQuerySchema.safeParse({}).success).toBe(false);
  });
});
