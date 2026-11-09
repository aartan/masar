import { describe, expect, it } from "vitest";
import { format } from "date-fns";

import {
  formatCalendarPeriod,
  getCalendarTaskStatus,
  groupTasksByDueDate,
  monthGridDates,
  sortCalendarTasks,
  weekDates,
  type CalendarTask,
} from "@/lib/calendar";
import type { Task } from "@/lib/types";

function task(overrides: Partial<Task> & Pick<Task, "id">): Task {
  return {
    boardId: "board-1",
    columnId: "todo",
    title: `Task ${overrides.id}`,
    description: null,
    priority: "none",
    dueDate: null,
    position: 0,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    labelIds: [],
    subtaskCount: 0,
    subtaskDoneCount: 0,
    commentCount: 0,
    imageCount: 0,
    ...overrides,
  };
}

function calendarTask(
  overrides: Partial<CalendarTask> & Pick<CalendarTask, "id">,
): CalendarTask {
  return {
    ...task(overrides),
    boardName: "Board",
    boardColor: "sage",
    columnName: "To Do",
    columnDone: false,
    ...overrides,
  };
}

describe("monthGridDates", () => {
  it("returns a six-week Monday-start grid that contains the whole month", () => {
    const days = monthGridDates(new Date(2026, 5, 15));

    expect(days).toHaveLength(42);
    expect(format(days[0]!, "yyyy-MM-dd")).toBe("2026-06-01");
    expect(format(days[41]!, "yyyy-MM-dd")).toBe("2026-07-12");
    expect(days[0]!.getDay()).toBe(1);
    expect(
      days.some((date) => format(date, "yyyy-MM-dd") === "2026-06-30"),
    ).toBe(true);
  });

  it("pads months that start mid-week", () => {
    const days = monthGridDates(new Date(2026, 7, 20));
    expect(format(days[0]!, "yyyy-MM-dd")).toBe("2026-07-27");
    expect(format(days[41]!, "yyyy-MM-dd")).toBe("2026-09-06");
  });
});

describe("weekDates", () => {
  it("returns Monday through Sunday for the cursor week", () => {
    const days = weekDates(new Date(2026, 5, 18));
    expect(days.map((date) => format(date, "EEE"))).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    expect(format(days[0]!, "yyyy-MM-dd")).toBe("2026-06-15");
    expect(format(days[6]!, "yyyy-MM-dd")).toBe("2026-06-21");
  });
});

describe("getCalendarTaskStatus", () => {
  const reference = "2026-06-15";

  it("classifies overdue, today, and upcoming tasks", () => {
    expect(getCalendarTaskStatus("2026-06-14", false, reference)).toBe(
      "overdue",
    );
    expect(getCalendarTaskStatus("2026-06-15", false, reference)).toBe("today");
    expect(getCalendarTaskStatus("2026-06-16", false, reference)).toBe(
      "upcoming",
    );
  });

  it("marks completed tasks as completed even when overdue", () => {
    expect(getCalendarTaskStatus("2026-06-14", true, reference)).toBe(
      "completed",
    );
  });
});

describe("groupTasksByDueDate", () => {
  it("groups dated tasks and ignores unscheduled ones", () => {
    const grouped = groupTasksByDueDate([
      task({ id: "a", dueDate: "2026-06-15" }),
      task({ id: "b", dueDate: "2026-06-15" }),
      task({ id: "c", dueDate: "2026-06-16" }),
      task({ id: "d", dueDate: null }),
    ]);

    expect(grouped.get("2026-06-15")?.map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
    expect(grouped.get("2026-06-16")?.map((item) => item.id)).toEqual(["c"]);
    expect(grouped.has("")).toBe(false);
  });
});

describe("sortCalendarTasks", () => {
  it("keeps open work first, then priority, then title", () => {
    const tasks = [
      calendarTask({ id: "done", columnDone: true, priority: "urgent" }),
      calendarTask({ id: "low", priority: "low", title: "Beta" }),
      calendarTask({ id: "urgent", priority: "urgent", title: "Zulu" }),
      calendarTask({ id: "high", priority: "high", title: "Alpha" }),
    ];

    expect(sortCalendarTasks(tasks).map((item) => item.id)).toEqual([
      "urgent",
      "high",
      "low",
      "done",
    ]);
  });
});

describe("formatCalendarPeriod", () => {
  const cursor = new Date(2026, 5, 18);

  it("formats month, week, and day periods", () => {
    expect(formatCalendarPeriod("month", cursor)).toBe("June 2026");
    expect(formatCalendarPeriod("week", cursor)).toBe(
      "Jun 15 – Jun 21, 2026",
    );
    expect(formatCalendarPeriod("day", cursor)).toBe(
      "Thursday, June 18, 2026",
    );
  });
});
