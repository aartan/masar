"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  CalendarCheck2,
  CalendarOff,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import { CalendarTaskChip } from "@/components/calendar/calendar-task-chip";
import { Badge } from "@/components/ui/badge";
import type { CalendarTask } from "@/lib/calendar";
import { cn } from "@/lib/utils";

export function UnscheduledPanel({
  tasks,
  open,
  onToggle,
  onOpenTask,
  className,
}: {
  tasks: CalendarTask[];
  open: boolean;
  onToggle: () => void;
  onOpenTask: (taskId: string) => void;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: "calendar-unscheduled",
    data: { type: "calendar-unscheduled" },
    disabled: !open,
  });

  return (
    <section
      ref={setNodeRef}
      aria-label="Unscheduled tasks"
      className={cn(
        "flex min-h-0 flex-col bg-background/35 transition-colors",
        open && "flex-1",
        isOver && "bg-primary/[0.06]",
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted/70 text-muted-foreground">
          <CalendarOff className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[12px] font-semibold tracking-[-0.01em]">
            Unscheduled
          </h2>
          <p className="mt-0.5 text-[9.5px] text-muted-foreground/70">
            Tasks without a due date
          </p>
        </div>
        <Badge
          variant="muted"
          aria-label={`${tasks.length} unscheduled ${tasks.length === 1 ? "task" : "tasks"}`}
          className="text-[10px] tabular-nums"
        >
          {tasks.length}
        </Badge>
        <button
          type="button"
          onClick={onToggle}
          aria-label={
            open
              ? "Collapse unscheduled tasks"
              : "Expand unscheduled tasks"
          }
          aria-expanded={open}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {open ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </button>
      </div>

      {open && (
        <div className="scrollbar-thin flex max-h-[38vh] min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2 lg:max-h-none">
          {tasks.map((task) => (
            <CalendarTaskChip
              key={task.id}
              task={task}
              layout="card"
              onClick={() => onOpenTask(task.id)}
            />
          ))}

          {tasks.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 px-4 py-8 text-center">
              <span className="grid size-9 place-items-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                <CalendarCheck2 className="size-4" />
              </span>
              <div>
                <p className="text-[12px] font-medium">Everything is scheduled</p>
                <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
                  Tasks without a due date will collect here.
                </p>
              </div>
            </div>
          )}

          {tasks.length > 0 && (
            <p className="mt-auto px-1 pt-2 pb-1 text-center text-[9.5px] leading-relaxed text-muted-foreground/55">
              Drag a task onto a calendar date to schedule it.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
