"use client";

import { useDroppable } from "@dnd-kit/core";
import { format, isToday } from "date-fns";

import {
  CalendarTaskChip,
  getTaskStatusDotClass,
} from "@/components/calendar/calendar-task-chip";
import {
  isSameCalendarMonth,
  monthGridDates,
  type CalendarTask,
} from "@/lib/calendar";
import { todayIso } from "@/lib/dates";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_VISIBLE_TASKS = 2;

export function CalendarMonthView({
  cursor,
  tasksByDate,
  onOpenTask,
  onOpenDay,
}: {
  cursor: Date;
  tasksByDate: Map<string, CalendarTask[]>;
  onOpenTask: (taskId: string) => void;
  onOpenDay: (date: Date) => void;
}) {
  const days = monthGridDates(cursor);

  return (
    <div className="h-full overflow-auto scrollbar-thin p-2 sm:p-4">
      <div className="flex h-full min-h-[540px] flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-soft">
        <div className="grid shrink-0 grid-cols-7 border-b border-border/70 bg-muted/20">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="px-1.5 py-2 text-center text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase sm:px-2 sm:text-left"
            >
              <span className="sm:hidden">{label.slice(0, 1)}</span>
              <span className="hidden sm:inline">{label}</span>
            </div>
          ))}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
          {days.map((date) => (
            <MonthDayCell
              key={todayIso(date)}
              date={date}
              cursor={cursor}
              tasks={tasksByDate.get(todayIso(date)) ?? []}
              onOpenTask={onOpenTask}
              onOpenDay={onOpenDay}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MonthDayCell({
  date,
  cursor,
  tasks,
  onOpenTask,
  onOpenDay,
}: {
  date: Date;
  cursor: Date;
  tasks: CalendarTask[];
  onOpenTask: (taskId: string) => void;
  onOpenDay: (date: Date) => void;
}) {
  const iso = todayIso(date);
  const { setNodeRef, isOver } = useDroppable({
    id: `calendar-day:${iso}`,
    data: { type: "calendar-day", date: iso },
  });
  const currentMonth = isSameCalendarMonth(date, cursor);
  const today = isToday(date);
  const visibleTasks = tasks.slice(0, MAX_VISIBLE_TASKS);
  const hiddenCount = tasks.length - visibleTasks.length;

  return (
    <div
      ref={setNodeRef}
      data-date={iso}
      className={cn(
        "group/day relative min-h-0 overflow-hidden border-r border-b border-border/55 p-1 text-left transition-colors last:border-r-0 sm:p-1.5",
        !currentMonth && "bg-muted/15",
        isOver && "bg-primary/[0.07] ring-2 ring-primary/60 ring-inset",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => onOpenDay(date)}
          aria-label={`Open ${format(date, "EEEE, MMMM d, yyyy")}`}
          title="Open day"
          className={cn(
            "grid size-5 place-items-center rounded-full text-[10px] font-medium tabular-nums transition-colors hover:bg-accent",
            today
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : currentMonth
                ? "text-foreground/80"
                : "text-muted-foreground",
          )}
        >
          {format(date, "d")}
        </button>
        {tasks.length > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground sm:hidden">
            {tasks.length}
          </span>
        )}
      </div>

      <div className="mt-1 flex flex-wrap content-start gap-0.5 sm:hidden">
        {visibleTasks.map((task) => (
          <span
            key={task.id}
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              getTaskStatusDotClass(task),
            )}
          />
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => onOpenDay(date)}
            aria-label={`Show ${hiddenCount} more tasks on ${format(date, "MMMM d")}`}
            className="text-[10px] leading-none font-medium text-muted-foreground hover:text-foreground"
          >
            +{hiddenCount} more
          </button>
        )}
      </div>

      <div className="mt-0.5 hidden min-h-0 flex-col gap-0.5 sm:flex">
        {visibleTasks.map((task) => (
          <CalendarTaskChip
            key={task.id}
            task={task}
            layout="compact"
            onClick={() => onOpenTask(task.id)}
          />
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => onOpenDay(date)}
            aria-label={`Show ${hiddenCount} more tasks on ${format(date, "MMMM d")}`}
            className="w-fit rounded px-1 text-[10px] leading-3 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            +{hiddenCount} more
          </button>
        )}
      </div>
    </div>
  );
}
