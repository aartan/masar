"use client";

import { useDroppable } from "@dnd-kit/core";
import { format, isToday } from "date-fns";

import { CalendarTaskChip } from "@/components/calendar/calendar-task-chip";
import { type CalendarTask, weekDates } from "@/lib/calendar";
import { todayIso } from "@/lib/dates";
import { cn } from "@/lib/utils";

export function CalendarWeekView({
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
  const days = weekDates(cursor);

  return (
    <div className="h-full overflow-auto scrollbar-thin p-2 sm:p-4">
      <div className="grid min-h-[560px] gap-2 md:h-full md:min-h-0 md:grid-cols-7">
        {days.map((date) => (
          <WeekDayColumn
            key={todayIso(date)}
            date={date}
            tasks={tasksByDate.get(todayIso(date)) ?? []}
            onOpenTask={onOpenTask}
            onOpenDay={onOpenDay}
          />
        ))}
      </div>
    </div>
  );
}

function WeekDayColumn({
  date,
  tasks,
  onOpenTask,
  onOpenDay,
}: {
  date: Date;
  tasks: CalendarTask[];
  onOpenTask: (taskId: string) => void;
  onOpenDay: (date: Date) => void;
}) {
  const iso = todayIso(date);
  const { setNodeRef, isOver } = useDroppable({
    id: `calendar-day:${iso}`,
    data: { type: "calendar-day", date: iso },
  });
  const today = isToday(date);

  return (
    <section
      ref={setNodeRef}
      data-date={iso}
      aria-label={format(date, "EEEE, MMMM d, yyyy")}
      className={cn(
        "flex min-h-[92px] flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-soft transition-colors md:min-h-0",
        today && "border-primary/30",
        isOver && "bg-primary/[0.06] ring-2 ring-primary/35 ring-inset",
      )}
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2.5 py-2">
        <button
          type="button"
          onClick={() => onOpenDay(date)}
          aria-label={`Open ${format(date, "EEEE, MMMM d, yyyy")}`}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <span
            className={cn(
              "text-[10px] font-semibold tracking-[0.08em] uppercase",
              today ? "text-primary" : "text-muted-foreground/65",
            )}
          >
            {format(date, "EEE")}
          </span>
          <span
            className={cn(
              "grid size-5 place-items-center rounded-full text-[11px] font-medium tabular-nums",
              today
                ? "bg-primary text-primary-foreground"
                : "text-foreground/75",
            )}
          >
            {format(date, "d")}
          </span>
        </button>
        <span className="rounded-full bg-muted/70 px-1.5 py-px text-[9.5px] tabular-nums text-muted-foreground/70">
          {tasks.length}
        </span>
      </div>

      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-1 p-1.5 md:overflow-y-auto">
        {tasks.map((task) => (
          <CalendarTaskChip
            key={task.id}
            task={task}
            layout="detailed"
            onClick={() => onOpenTask(task.id)}
          />
        ))}
        {tasks.length === 0 && (
          <div className="grid flex-1 place-items-center px-2 py-4 text-center text-[10px] text-muted-foreground/40">
            Drop a task here
          </div>
        )}
      </div>
    </section>
  );
}
