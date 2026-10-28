"use client";

import * as React from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  GripVertical,
  ListFilter,
  Loader2,
  MoreHorizontal,
  PencilLine,
  Plus,
  Trash2,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TaskCard } from "@/components/board/task-card";
import type { BoardColumn, Label, Task } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ColumnTaskHandlers {
  onOpenTask: (taskId: string) => void;
  onDuplicateTask: (task: Task) => void;
  onMoveTask: (taskId: string, columnId: string) => void;
  onDeleteTask: (task: Task) => void;
}

export function BoardColumn({
  column,
  tasks,
  totalTaskCount,
  columns,
  labels,
  filtersActive,
  dragDisabled,
  canMoveLeft,
  canMoveRight,
  onOpenNewTask,
  onCreateInline,
  onEditColumn,
  onToggleDone,
  onMoveColumn,
  onDeleteColumn,
  onClearFilters,
  taskHandlers,
}: {
  column: BoardColumn;
  tasks: Task[];
  totalTaskCount: number;
  columns: BoardColumn[];
  labels: Label[];
  filtersActive: boolean;
  dragDisabled: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onOpenNewTask: (columnId: string) => void;
  onCreateInline: (columnId: string, title: string) => Promise<boolean>;
  onEditColumn: (column: BoardColumn) => void;
  onToggleDone: (column: BoardColumn) => void;
  onMoveColumn: (columnId: string, direction: -1 | 1) => void;
  onDeleteColumn: (column: BoardColumn) => void;
  onClearFilters: () => void;
  taskHandlers: ColumnTaskHandlers;
}) {
  const [composing, setComposing] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `col:${column.id}`,
    data: { type: "column", columnId: column.id },
    disabled: dragDisabled,
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop:${column.id}`,
    data: { type: "column-drop", columnId: column.id },
  });

  React.useEffect(() => {
    if (composing) {
      window.setTimeout(() => textareaRef.current?.focus(), 30);
    }
  }, [composing]);

  async function submitInline() {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const ok = await onCreateInline(column.id, trimmed);
    setSaving(false);
    if (ok) {
      setTitle("");
      textareaRef.current?.focus();
    }
  }

  const countLabel =
    filtersActive && tasks.length !== totalTaskCount
      ? `${tasks.length}/${totalTaskCount}`
      : `${totalTaskCount}`;

  return (
    <section
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      data-column-id={column.id}
      aria-label={`${column.name} column`}
      className={cn(
        "flex h-full w-[84vw] max-w-[316px] shrink-0 snap-start flex-col rounded-2xl border border-border/60 bg-muted/35 transition-[box-shadow,opacity] sm:w-[300px]",
        isDragging && "z-20 opacity-60 shadow-float",
        isOver && "ring-2 ring-primary/20",
      )}
    >
      <header className="flex items-center gap-1 px-2.5 pt-2.5 pb-1.5">
        <button
          type="button"
          className={cn(
            "grid size-5 shrink-0 cursor-grab place-items-center rounded text-muted-foreground/30 opacity-0 transition-opacity group-hover/column:opacity-100 hover:bg-accent hover:text-muted-foreground focus-visible:opacity-100 active:cursor-grabbing sm:group-hover/column:opacity-100",
            dragDisabled && "cursor-not-allowed",
          )}
          aria-label={`Reorder ${column.name} column`}
          title={
            dragDisabled
              ? "Clear filters to reorder columns"
              : `Reorder ${column.name}`
          }
          {...attributes}
          {...listeners}
          disabled={dragDisabled}
        >
          <GripVertical className="size-3.5" />
        </button>
        {column.isDone ? (
          <CheckCircle2 className="size-3.5 shrink-0 text-primary/70" />
        ) : (
          <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/25" />
        )}
        <h3 className="truncate text-[12.5px] font-semibold tracking-[-0.01em] text-foreground/90">
          {column.name}
        </h3>
        <span className="ml-0.5 rounded-full bg-foreground/5 px-1.5 py-px text-[10px] font-medium tabular-nums text-muted-foreground">
          {countLabel}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onOpenNewTask(column.id)}
            className="grid size-6 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
            aria-label={`Add task to ${column.name}`}
          >
            <Plus className="size-3.5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="grid size-6 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                aria-label={`Column actions for ${column.name}`}
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => onEditColumn(column)}>
                <PencilLine />
                Rename column
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onToggleDone(column)}>
                <CheckCircle2 />
                {column.isDone
                  ? "Remove completion status"
                  : "Set as completion column"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => onMoveColumn(column.id, -1)}
                disabled={!canMoveLeft}
              >
                <ArrowLeft />
                Move left
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => onMoveColumn(column.id, 1)}
                disabled={!canMoveRight}
              >
                <ArrowRight />
                Move right
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={columns.length <= 1}
                onSelect={() => onDeleteColumn(column)}
              >
                <Trash2 />
                Delete column
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div
        ref={setDropRef}
        className={cn(
          "scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pt-1 transition-colors",
          isOver && "bg-primary/[0.025]",
        )}
      >
        <SortableContext
          items={tasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex min-h-full flex-col gap-2 pb-2">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                column={column}
                columns={columns}
                labels={labels}
                disabled={dragDisabled}
                onOpen={() => taskHandlers.onOpenTask(task.id)}
                onDuplicate={() => taskHandlers.onDuplicateTask(task)}
                onMoveTo={(columnId) =>
                  taskHandlers.onMoveTask(task.id, columnId)
                }
                onDelete={() => taskHandlers.onDeleteTask(task)}
              />
            ))}

            {tasks.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center px-3 py-8 text-center">
                {filtersActive && totalTaskCount > 0 ? (
                  <>
                    <ListFilter className="size-4 text-muted-foreground/40" />
                    <p className="mt-2 text-[11.5px] text-muted-foreground">
                      No tasks match the current filters.
                    </p>
                    <button
                      type="button"
                      onClick={onClearFilters}
                      className="mt-1 text-[11px] font-medium text-primary hover:underline"
                    >
                      Clear filters
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-[11.5px] text-muted-foreground/70">
                      No tasks yet.
                    </p>
                    <button
                      type="button"
                      onClick={() => setComposing(true)}
                      className="mt-1 text-[11px] font-medium text-primary hover:underline"
                    >
                      Add the first one
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </SortableContext>
      </div>

      <div className="px-2 pt-0.5 pb-2">
        {composing ? (
          <div className="rounded-xl border border-border/80 bg-card p-2 shadow-soft">
            <textarea
              ref={textareaRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submitInline();
                }
                if (event.key === "Escape") {
                  setComposing(false);
                  setTitle("");
                }
              }}
              placeholder="Write a task and press Enter…"
              rows={2}
              maxLength={200}
              className="w-full resize-none bg-transparent px-1 py-1 text-[12.5px] leading-relaxed outline-none placeholder:text-muted-foreground/50"
            />
            <div className="mt-1 flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setComposing(false);
                  setTitle("");
                }}
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitInline()}
                disabled={!title.trim() || saving}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
              >
                {saving && <Loader2 className="size-3 animate-spin" />}
                Add
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[12px] text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            <Plus className="size-3.5" />
            Add task
          </button>
        )}
      </div>
    </section>
  );
}
