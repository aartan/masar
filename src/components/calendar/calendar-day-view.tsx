"use client";

import { useDroppable } from "@dnd-kit/core";
import { CalendarDays, CheckCircle2 } from "lucide-react";
import { format, isToday } from "date-fns";

import { CalendarTaskChip } from "@/components/calendar/calendar-task-chip";
import type { CalendarTask } from "@/lib/calendar";
import { todayIso } from "@/lib/dates";
import { cn } from "@/lib/utils";

export function CalendarDayView({
  cursor,
  tasks,
  onOpenTask,
}: {
  cursor: Date;
  tasks: CalendarTask[];
  onOpenTask: (taskId: string) => void;
}) {
  const iso = todayIso(cursor);
  const { setNodeRef, isOver } = useDroppable({
    id: `calendar-day:${iso}`,
    data: { type: "calendar-day", date: iso },
  });
  const today = isToday(cursor);
  const openCount = tasks.filter((task) => !task.columnDone).length;

  return (
    <div className="h-full overflow-auto scrollbar-thin p-3 sm:p-6">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
        <section
          ref={setNodeRef}
          data-date={iso}
          aria-label={format(cursor, "EEEE, MMMM d, yyyy")}
          className={cn(
            "flex min-h-[440px] flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-soft transition-colors",
            today && "border-primary/30",
            isOver && "bg-primary/[0.05] ring-2 ring-primary/35 ring-inset",
          )}
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-border/65 px-4 py-3 sm:px-5">
            <span
              className={cn(
                "grid size-11 shrink-0 place-items-center rounded-xl text-[17px] font-semibold tabular-nums",
                today
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-foreground",
              )}
            >
              {format(cursor, "d")}
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-[16px] font-semibold tracking-[-0.02em]">
                {format(cursor, "EEEE")}
              </h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {format(cursor, "MMMM d, yyyy")} · {tasks.length}{" "}
                {tasks.length === 1 ? "task" : "tasks"}
                {openCount !== tasks.length ? ` · ${openCount} open` : ""}
              </p>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 p-3 sm:p-4">
            {tasks.map((task) => (
              <CalendarTaskChip
                key={task.id}
                task={task}
                layout="detailed"
                onClick={() => onOpenTask(task.id)}
                className="px-3 py-2.5"
              />
            ))}

            {tasks.length === 0 && (
              <div className="grid flex-1 place-items-center px-4 py-12 text-center">
                <div>
                  <span className="mx-auto grid size-11 place-items-center rounded-full bg-accent text-accent-foreground">
                    <CalendarDays className="size-5" strokeWidth={1.7} />
                  </span>
                  <p className="mt-3 text-[13px] font-medium">
                    Nothing scheduled
                  </p>
                  <p className="mx-auto mt-1 max-w-xs text-[11.5px] leading-relaxed text-muted-foreground">
                    Drag a task here from the Unscheduled list or another
                    calendar date to schedule it.
                  </p>
                </div>
              </div>
            )}

            {tasks.length > 0 && (
              <div className="mt-auto flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/55 px-3 py-3 text-[10.5px] text-muted-foreground/55">
                <CheckCircle2 className="size-3.5" />
                Drop another task here to schedule it for this day.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
