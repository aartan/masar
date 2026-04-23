"use client";

import * as React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Check,
  Copy,
  GripVertical,
  ListChecks,
  MessageSquare,
  MoreHorizontal,
  PencilLine,
  Trash2,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AssigneeAvatar,
  DueDateChip,
  LabelChip,
  PriorityBars,
} from "@/components/shared/task-meta";
import type { BoardColumn, Label, Task } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TaskCard({
  task,
  column,
  columns,
  labels,
  disabled,
  onOpen,
  onDuplicate,
  onMoveTo,
  onDelete,
}: {
  task: Task;
  column: BoardColumn;
  columns: BoardColumn[];
  labels: Label[];
  disabled?: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
  onMoveTo: (columnId: string) => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: "task", taskId: task.id, columnId: task.columnId },
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const taskLabels = task.labelIds
    .map((id) => labels.find((label) => label.id === id))
    .filter((label): label is Label => Boolean(label))
    .slice(0, 3);
  const extraLabels = task.labelIds.length - taskLabels.length;
  const otherColumns = columns.filter((item) => item.id !== column.id);
  const subtaskComplete =
    task.subtaskCount > 0 && task.subtaskDoneCount === task.subtaskCount;
  const handlePointerDown = listeners?.onPointerDown as
    | React.PointerEventHandler<HTMLElement>
    | undefined;

  return (
    <article
      ref={setNodeRef}
      style={style}
      data-task-id={task.id}
      data-column-id={column.id}
      tabIndex={0}
      role="button"
      aria-label={`Open task: ${task.title}`}
      onClick={onOpen}
      onPointerDown={handlePointerDown}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          if (event.target === event.currentTarget) {
            event.preventDefault();
            onOpen();
          }
        }
      }}
      className={cn(
        "group relative cursor-pointer rounded-xl border border-border/75 bg-card p-3 text-left shadow-soft outline-none transition-[border-color,box-shadow,opacity,transform] hover:border-border hover:shadow-float focus-visible:ring-2 focus-visible:ring-ring/40",
        isDragging && "opacity-35",
      )}
    >
      <div className="flex min-h-6 items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          {taskLabels.map((label) => (
            <LabelChip key={label.id} label={label} />
          ))}
          {extraLabels > 0 && (
            <span className="text-[10px] font-medium text-muted-foreground">
              +{extraLabels}
            </span>
          )}
        </div>
        <div
          className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <button
            ref={setActivatorNodeRef}
            type="button"
            className={cn(
              "grid size-5 cursor-grab place-items-center rounded text-muted-foreground/50 hover:bg-accent hover:text-foreground active:cursor-grabbing",
              disabled && "cursor-not-allowed opacity-30",
            )}
            aria-label={`Drag task: ${task.title}`}
            title={
              disabled ? "Clear filters to reorder tasks" : "Drag to reorder"
            }
            onPointerDown={(event) => event.stopPropagation()}
            {...attributes}
            {...listeners}
            disabled={disabled}
          >
            <GripVertical className="size-3.5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="grid size-5 place-items-center rounded text-muted-foreground/50 hover:bg-accent hover:text-foreground"
                aria-label={`Task actions for ${task.title}`}
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={onOpen}>
                <PencilLine />
                Open task
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onDuplicate}>
                <Copy />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={otherColumns.length === 0}>
                  <Check />
                  Move to
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-44">
                  {otherColumns.map((item) => (
                    <DropdownMenuItem
                      key={item.id}
                      onSelect={() => onMoveTo(item.id)}
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          item.isDone ? "bg-primary" : "bg-muted-foreground/40",
                        )}
                      />
                      {item.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 />
                Delete task
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <h4
        className={cn(
          "mt-1.5 text-[13px] leading-[1.4] font-medium text-foreground",
          column.isDone && "text-muted-foreground",
        )}
      >
        {task.title}
      </h4>
      {task.description && (
        <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground/80">
          {task.description}
        </p>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {task.priority !== "none" && <PriorityBars priority={task.priority} />}
          <DueDateChip task={task} columnDone={column.isDone} />
        </div>
        <div className="flex shrink-0 items-center gap-2 text-muted-foreground/70">
          {task.subtaskCount > 0 && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-[10px] tabular-nums",
                subtaskComplete && "text-emerald-600 dark:text-emerald-400",
              )}
              title={`${task.subtaskDoneCount} of ${task.subtaskCount} subtasks complete`}
            >
              <ListChecks className="size-3" />
              {task.subtaskDoneCount}/{task.subtaskCount}
            </span>
          )}
          {task.commentCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] tabular-nums"
              title={`${task.commentCount} comments`}
            >
              <MessageSquare className="size-3" />
              {task.commentCount}
            </span>
          )}
          <AssigneeAvatar name={task.assignee} />
        </div>
      </div>
    </article>
  );
}
