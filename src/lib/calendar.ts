import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";

import { PRIORITY_META } from "@/lib/constants";
import type { BoardColor } from "@/lib/constants";
import { todayIso } from "@/lib/dates";
import type { Task } from "@/lib/types";

export const CALENDAR_VIEWS = ["month", "week", "day"] as const;
export type CalendarViewMode = (typeof CALENDAR_VIEWS)[number];

export type CalendarTaskStatus =
  | "completed"
  | "overdue"
  | "today"
  | "upcoming";

export interface CalendarTask extends Task {
  boardName: string;
  boardColor: BoardColor;
  columnName: string;
  columnDone: boolean;
}

const WEEK_OPTIONS = { weekStartsOn: 1 as const };

/** All 42 cells of a Monday-start month grid. */
export function monthGridDates(cursor: Date): Date[] {
  const start = startOfWeek(startOfMonth(cursor), WEEK_OPTIONS);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

/** The seven days of the Monday-start week containing the cursor. */
export function weekDates(cursor: Date): Date[] {
  const start = startOfWeek(cursor, WEEK_OPTIONS);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function isSameCalendarMonth(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth()
  );
}

export function getCalendarTaskStatus(
  dueDate: string,
  completed: boolean,
  referenceIso = todayIso(),
): CalendarTaskStatus {
  if (completed) return "completed";
  if (dueDate < referenceIso) return "overdue";
  if (dueDate === referenceIso) return "today";
  return "upcoming";
}

export function groupTasksByDueDate<T extends Pick<Task, "dueDate">>(
  tasks: T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const list = grouped.get(task.dueDate) ?? [];
    list.push(task);
    grouped.set(task.dueDate, list);
  }
  return grouped;
}

/** Open work first, then priority, then title for a stable calendar order. */
export function sortCalendarTasks<T extends CalendarTask>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (a.columnDone !== b.columnDone) return a.columnDone ? 1 : -1;
    const priority =
      PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank;
    if (priority !== 0) return priority;
    return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  });
}

export function formatCalendarPeriod(
  view: CalendarViewMode,
  cursor: Date,
): string {
  if (view === "month") return format(cursor, "MMMM yyyy");
  if (view === "week") {
    const start = startOfWeek(cursor, WEEK_OPTIONS);
    const end = addDays(start, 6);
    return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  }
  return format(cursor, "EEEE, MMMM d, yyyy");
}

export function monthBounds(cursor: Date): { from: string; to: string } {
  return {
    from: todayIso(startOfMonth(cursor)),
    to: todayIso(endOfMonth(cursor)),
  };
}

export function weekBounds(cursor: Date): { from: string; to: string } {
  return {
    from: todayIso(startOfWeek(cursor, WEEK_OPTIONS)),
    to: todayIso(endOfWeek(cursor, WEEK_OPTIONS)),
  };
}
