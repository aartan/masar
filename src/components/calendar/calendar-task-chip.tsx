"use client";

import { useDraggable } from "@dnd-kit/core";
import { AlertTriangle, GripVertical } from "lucide-react";

import { BOARD_COLOR_CLASS } from "@/components/shared/colors";
import { PriorityBars } from "@/components/shared/task-meta";
import {
  getCalendarTaskStatus,
  type CalendarTask,
  type CalendarTaskStatus,
} from "@/lib/calendar";
import { cn } from "@/lib/utils";

const STATUS_BORDER: Record<CalendarTaskStatus, string> = {
  completed: "border-l-emerald-500 bg-emerald-500/[0.055]",
  overdue: "border-l-rose-500 bg-rose-500/[0.055]",
  today: "border-l-amber-500 bg-amber-500/[0.06]",
  upcoming: "border-l-sky-500/70",
};

const STATUS_DOT: Record<CalendarTaskStatus, string> = {
  completed: "bg-emerald-500",
  overdue: "bg-rose-500",
  today: "bg-amber-500",
  upcoming: "bg-sky-500",
};

export function getTaskStatusDotClass(task: CalendarTask): string {
  if (!task.dueDate) return "bg-muted-foreground/30";
  return STATUS_DOT[getCalendarTaskStatus(task.dueDate, task.columnDone)];
}

export function CalendarTaskChip({
  task,
  layout = "compact",
  onClick,
  className,
}: {
  task: CalendarTask;
  layout?: "compact" | "detailed" | "card";
  onClick: () => void;
  className?: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: {
      type: "calendar-task",
      taskId: task.id,
      dueDate: task.dueDate,
    },
  });
  const status = task.dueDate
    ? getCalendarTaskStatus(task.dueDate, task.columnDone)
    : "upcoming";
  const detailed = layout !== "compact";
  const card = layout === "card";

  return (
    <button
      ref={setNodeRef}
      type="button"
      data-calendar-task-id={task.id}
      aria-label={`Open task: ${task.title}`}
      title={`${task.title} · ${task.boardName}`}
      onClick={(event) => {
        if (isDragging) return;
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "group/calendar-task relative flex w-full min-w-0 touch-none items-start gap-1.5 rounded-md border border-l-2 border-border/65 bg-card text-left outline-none transition-[background-color,border-color,box-shadow,opacity] hover:border-border hover:shadow-soft focus-visible:ring-2 focus-visible:ring-ring",
        task.dueDate ? STATUS_BORDER[status] : "border-l-border/70",
        detailed ? "px-2 py-1.5" : "items-center px-1.5 py-px",
        card && "rounded-lg px-2.5 py-2 shadow-soft",
        isDragging && "opacity-30",
        className,
      )}
      {...attributes}
      {...listeners}
    >
      {layout !== "detailed" && (
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            BOARD_COLOR_CLASS[task.boardColor],
            "board-dot",
            card ? "mt-[5px]" : "mt-0",
          )}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1">
          <span
            className={cn(
              "min-w-0 font-medium",
              detailed
                ? "line-clamp-2 text-[11.5px] leading-snug"
                : "truncate text-[10px] leading-3",
              task.columnDone
                ? "text-muted-foreground line-through decoration-muted-foreground/50"
                : "text-foreground",
            )}
          >
            {task.title}
          </span>
          {detailed && status === "overdue" && (
            <AlertTriangle className="size-3 shrink-0 text-destructive" />
          )}
        </span>
        {detailed && (
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="min-w-0 truncate">{task.boardName}</span>
            <span className="text-muted-foreground">·</span>
            <span className="shrink-0">{task.columnName}</span>
            {task.priority !== "none" && (
              <PriorityBars priority={task.priority} className="ml-auto" />
            )}
          </span>
        )}
      </span>
      {card && (
        <GripVertical className="mt-[1px] size-3 shrink-0 text-muted-foreground transition-colors group-hover/calendar-task:text-foreground" />
      )}
    </button>
  );
}

export function CalendarTaskDragOverlay({ task }: { task: CalendarTask }) {
  return (
    <div className="w-[250px] rotate-[1deg] cursor-grabbing rounded-xl border border-border/80 bg-card p-2.5 shadow-float">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            BOARD_COLOR_CLASS[task.boardColor],
            "board-dot",
          )}
        />
        <span className="truncate text-[12px] font-medium">{task.title}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 pl-3 text-[10px] text-muted-foreground">
        <span className="truncate">{task.boardName}</span>
        <span className="text-muted-foreground">/</span>
        <span className="truncate">{task.columnName}</span>
        <PriorityBars priority={task.priority} className="ml-auto" />
      </div>
    </div>
  );
}
