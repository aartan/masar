import {
  differenceInCalendarDays,
  format,
  formatDistanceToNow,
  isToday,
  isTomorrow,
  isYesterday,
  parseISO,
} from "date-fns";

/** Local calendar date as YYYY-MM-DD. */
export function todayIso(date = new Date()): string {
  return format(date, "yyyy-MM-dd");
}

export function addDaysIso(iso: string, days: number): string {
  const date = parseISO(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return todayIso(date);
}

export function formatDueDate(
  dueDate: string | null,
  reference = new Date(),
): string | null {
  if (!dueDate) return null;
  const date = parseISO(`${dueDate}T00:00:00`);
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  if (isYesterday(date)) return "Yesterday";
  if (date.getFullYear() === reference.getFullYear()) {
    return format(date, "MMM d");
  }
  return format(date, "MMM d, yyyy");
}

export function formatDateTime(iso: string): string {
  return format(new Date(iso), "MMM d, yyyy 'at' h:mm a");
}

export function formatRelative(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

export function dueDayDelta(dueDate: string, referenceIso = todayIso()): number {
  return differenceInCalendarDays(
    parseISO(`${dueDate}T00:00:00`),
    parseISO(`${referenceIso}T00:00:00`),
  );
}

export function isOverdue(dueDate: string | null, done: boolean): boolean {
  if (!dueDate || done) return false;
  return dueDate < todayIso();
}

export function formatDateInputValue(iso: string | null): string {
  return iso ?? "";
}
