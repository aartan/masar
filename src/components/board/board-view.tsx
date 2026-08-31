"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  ChevronRight,
  Info,
  LayoutGrid,
  List,
  Loader2,
  MoreHorizontal,
  PencilLine,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { BoardColumn } from "@/components/board/board-column";
import { BoardListView } from "@/components/board/board-list-view";
import { FilterBar } from "@/components/board/filter-bar";
import { TaskDetailSheet } from "@/components/board/task-detail-sheet";
import {
  BoardSettingsDialog,
  ColumnFormDialog,
  NewTaskDialog,
} from "@/components/board/board-dialogs";
import {
  AssigneeAvatar,
  DueDateChip,
  LabelChip,
  PriorityBars,
} from "@/components/shared/task-meta";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { BOARD_COLOR_CLASS } from "@/components/shared/colors";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, errorMessage } from "@/lib/client-api";
import { todayIso } from "@/lib/dates";
import {
  buildTaskOrderPayload,
  completionPercent,
  EMPTY_FILTERS,
  filterAndSortTasks,
  getFilteredColumnTasks,
  getOrderedTasks,
  hasActiveFilters,
  moveColumn,
  moveTaskToColumnEnd,
  moveTaskToIndex,
  type TaskFilters,
} from "@/lib/task-utils";
import type {
  BoardColumn as BoardColumnType,
  BoardDetail,
  BoardSummary,
  Label,
  Task,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type DragData = {
  type?: "task" | "column" | "column-drop";
  taskId?: string;
  columnId?: string;
};

type ViewMode = "board" | "list";

const VIEW_STORAGE_KEY = "masar:board-view";
const VIEW_CHANGE_EVENT = "masar:board-view-change";

function subscribeToView(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(VIEW_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(VIEW_CHANGE_EVENT, onStoreChange);
  };
}

function readStoredView(): ViewMode {
  return window.localStorage.getItem(VIEW_STORAGE_KEY) === "list"
    ? "list"
    : "board";
}

function getServerView(): ViewMode {
  return "board";
}

export function BoardView({
  initialData,
  initialTaskId,
}: {
  initialData: BoardDetail;
  initialTaskId?: string;
}) {
  const router = useRouter();
  const [board, setBoard] = React.useState<BoardSummary>(initialData.board);
  const [columns, setColumns] = React.useState<BoardColumnType[]>(
    initialData.columns,
  );
  const [tasks, setTasks] = React.useState<Task[]>(initialData.tasks);
  const [labels, setLabels] = React.useState<Label[]>(initialData.labels);
  const [filters, setFilters] = React.useState<TaskFilters>({
    ...EMPTY_FILTERS,
  });
  const view = React.useSyncExternalStore(
    subscribeToView,
    readStoredView,
    getServerView,
  );
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(
    initialTaskId ?? null,
  );
  const [newTaskOpen, setNewTaskOpen] = React.useState(false);
  const [newTaskColumnId, setNewTaskColumnId] = React.useState<
    string | undefined
  >();
  const [columnDialogOpen, setColumnDialogOpen] = React.useState(false);
  const [editingColumn, setEditingColumn] =
    React.useState<BoardColumnType | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [deleteBoardOpen, setDeleteBoardOpen] = React.useState(false);
  const [deleteColumnTarget, setDeleteColumnTarget] =
    React.useState<BoardColumnType | null>(null);
  const [deleteTaskTarget, setDeleteTaskTarget] = React.useState<Task | null>(
    null,
  );
  const [activeTaskId, setActiveTaskId] = React.useState<string | null>(null);
  const [activeColumnId, setActiveColumnId] = React.useState<string | null>(
    null,
  );
  const [isReordering, setIsReordering] = React.useState(false);
  const dragSnapshotRef = React.useRef<{
    tasks: Task[];
    columns: BoardColumnType[];
  } | null>(null);

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() !== "n" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable='true'], [role='dialog'], [role='alertdialog']",
        )
      ) {
        return;
      }
      if (
        document.querySelector(
          "[role='dialog'][data-state='open'], [role='alertdialog'][data-state='open']",
        )
      ) {
        return;
      }
      event.preventDefault();
      setNewTaskColumnId(undefined);
      setNewTaskOpen(true);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const filteredTasks = React.useMemo(
    () => filterAndSortTasks(tasks, filters),
    [tasks, filters],
  );
  const filtersActive = hasActiveFilters(filters);
  const reorderPaused = filtersActive || filters.sort !== "manual";
  const dragDisabled = reorderPaused || isReordering;
  const doneColumnIds = new Set(
    columns.filter((column) => column.isDone).map((column) => column.id),
  );
  const doneCount = tasks.filter((task) => doneColumnIds.has(task.columnId)).length;
  const overdueCount = tasks.filter(
    (task) =>
      !doneColumnIds.has(task.columnId) &&
      task.dueDate &&
      task.dueDate < todayIso(),
  ).length;
  const completion = completionPercent(doneCount, tasks.length);
  const selectedTask =
    tasks.find((task) => task.id === selectedTaskId) ?? null;
  const activeTask = tasks.find((task) => task.id === activeTaskId) ?? null;
  const activeColumn =
    columns.find((column) => column.id === activeColumnId) ?? null;
  const defaultColumnId =
    columns.find((column) => column.name.toLowerCase() === "to do")?.id ??
    columns[0]?.id;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const collisionDetection = React.useCallback<CollisionDetection>((args) => {
    const activeType = (args.active.data.current as DragData | undefined)?.type;
    const droppableContainers = args.droppableContainers.filter((container) => {
      const type = (container.data.current as DragData | undefined)?.type;
      if (activeType === "column") return type === "column";
      return type === "task" || type === "column-drop";
    });

    if (activeType === "column") {
      return closestCenter({ ...args, droppableContainers });
    }

    const pointerCollisions = pointerWithin({
      ...args,
      droppableContainers,
    });
    const taskCollision = pointerCollisions.find(
      (collision) =>
        (collision.data?.droppableContainer.data.current as DragData | undefined)
          ?.type === "task",
    );
    if (taskCollision) return [taskCollision];
    if (pointerCollisions.length > 0) return pointerCollisions;
    return closestCorners({ ...args, droppableContainers });
  }, []);

  function openTask(taskId: string) {
    setSelectedTaskId(taskId);
    window.history.replaceState(null, "", `/boards/${board.id}?task=${taskId}`);
  }

  function handleSheetOpenChange(open: boolean) {
    if (open) return;
    setSelectedTaskId(null);
    window.history.replaceState(null, "", `/boards/${board.id}`);
  }

  function changeView(next: ViewMode) {
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    window.dispatchEvent(new Event(VIEW_CHANGE_EVENT));
  }

  function handleTaskUpdated(updated: Task) {
    const existing = tasks.find((task) => task.id === updated.id);
    setTasks((current) =>
      current.map((task) =>
        task.id === updated.id ? { ...task, ...updated } : task,
      ),
    );
    if (existing && existing.columnId !== updated.columnId) {
      router.refresh();
    }
  }

  function handleTaskCreated(task: Task) {
    setTasks((current) => [...current, task]);
    router.refresh();
  }

  function handleTaskDuplicated(task: Task) {
    setTasks((current) => [...current, task]);
    router.refresh();
  }

  function handleTaskDeletedFromSheet(taskId: string) {
    setTasks((current) => current.filter((task) => task.id !== taskId));
    setSelectedTaskId(null);
    window.history.replaceState(null, "", `/boards/${board.id}`);
    router.refresh();
  }

  async function duplicateTask(task: Task) {
    try {
      const { task: copy } = await api<{ task: Task }>(
        `/api/tasks/${task.id}/duplicate`,
        { method: "POST" },
      );
      setTasks((current) => [...current, copy]);
      toast.success("Task duplicated", { description: copy.title });
      router.refresh();
    } catch (error) {
      toast.error("Could not duplicate task", {
        description: errorMessage(error),
      });
    }
  }

  async function deleteTaskFromCard() {
    if (!deleteTaskTarget) return;
    try {
      await api(`/api/tasks/${deleteTaskTarget.id}`, { method: "DELETE" });
      setTasks((current) =>
        current.filter((task) => task.id !== deleteTaskTarget.id),
      );
      setDeleteTaskTarget(null);
      toast.success("Task deleted");
      router.refresh();
    } catch (error) {
      toast.error("Could not delete task", {
        description: errorMessage(error),
      });
    }
  }

  async function createInlineTask(
    columnId: string,
    title: string,
  ): Promise<boolean> {
    try {
      const { task } = await api<{ task: Task }>(
        `/api/boards/${board.id}/tasks`,
        {
          method: "POST",
          body: JSON.stringify({ columnId, title }),
        },
      );
      setTasks((current) => [...current, task]);
      router.refresh();
      return true;
    } catch (error) {
      toast.error("Could not add task", {
        description: errorMessage(error),
      });
      return false;
    }
  }

  async function commitTaskOrder(
    nextTasks: Task[],
    previousTasks: Task[],
    columnName?: string,
  ) {
    setIsReordering(true);
    try {
      const data = await api<{ tasks: Task[] }>(
        `/api/boards/${board.id}/tasks/reorder`,
        {
          method: "POST",
          body: JSON.stringify(buildTaskOrderPayload(nextTasks, columns)),
        },
      );
      setTasks(data.tasks);
      if (columnName) {
        toast.success(`Moved to ${columnName}`);
      }
      router.refresh();
    } catch (error) {
      setTasks(previousTasks);
      toast.error("Could not save the new order", {
        description: errorMessage(error),
      });
    } finally {
      setIsReordering(false);
    }
  }

  async function moveTask(taskId: string, columnId: string) {
    if (dragDisabled) return;
    const current = tasks.find((task) => task.id === taskId);
    const target = columns.find((column) => column.id === columnId);
    if (!current || !target || current.columnId === columnId) return;
    const next = moveTaskToColumnEnd(tasks, taskId, columnId);
    setTasks(next);
    await commitTaskOrder(next, tasks, target.name);
  }

  async function commitColumnOrder(
    nextColumns: BoardColumnType[],
    previousColumns: BoardColumnType[],
  ) {
    setColumns(nextColumns);
    setIsReordering(true);
    try {
      const data = await api<{ columns: BoardColumnType[] }>(
        `/api/boards/${board.id}/columns/reorder`,
        {
          method: "POST",
          body: JSON.stringify({
            columnIds: nextColumns.map((column) => column.id),
          }),
        },
      );
      setColumns(data.columns);
    } catch (error) {
      setColumns(previousColumns);
      toast.error("Could not save column order", {
        description: errorMessage(error),
      });
    } finally {
      setIsReordering(false);
    }
  }

  function moveColumnByDirection(columnId: string, direction: -1 | 1) {
    if (dragDisabled) return;
    const index = columns.findIndex((column) => column.id === columnId);
    const target = columns[index + direction];
    if (!target) return;
    const next = moveColumn(columns, columnId, target.id);
    void commitColumnOrder(next, columns);
  }

  function handleColumnSaved(saved: BoardColumnType) {
    setColumns((current) => {
      const base = saved.isDone
        ? current.map((column) =>
            column.id === saved.id ? column : { ...column, isDone: false },
          )
        : current;
      const exists = base.some((column) => column.id === saved.id);
      const next = exists
        ? base.map((column) => (column.id === saved.id ? saved : column))
        : [...base, saved];
      return next.sort((a, b) => a.position - b.position);
    });
  }

  async function toggleColumnDone(column: BoardColumnType) {
    try {
      const { column: saved } = await api<{ column: BoardColumnType }>(
        `/api/columns/${column.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ isDone: !column.isDone }),
        },
      );
      handleColumnSaved(saved);
      toast.success(
        saved.isDone
          ? "Completion column updated"
          : "Completion status removed",
      );
    } catch (error) {
      toast.error("Could not update column", {
        description: errorMessage(error),
      });
    }
  }

  async function reloadBoard() {
    const data = await api<{ board: BoardDetail }>(
      `/api/boards/${board.id}`,
    );
    setBoard(data.board.board);
    setColumns(data.board.columns);
    setTasks(data.board.tasks);
    setLabels(data.board.labels);
    if (
      selectedTaskId &&
      !data.board.tasks.some((task) => task.id === selectedTaskId)
    ) {
      setSelectedTaskId(null);
    }
    return data.board;
  }

  async function deleteColumn() {
    if (!deleteColumnTarget) return;
    const target = columns.find(
      (column) => column.id !== deleteColumnTarget.id,
    );
    try {
      const result = await api<{ movedTasks: number; targetColumnId: string }>(
        `/api/columns/${deleteColumnTarget.id}`,
        { method: "DELETE" },
      );
      setDeleteColumnTarget(null);
      await reloadBoard();
      toast.success("Column deleted", {
        description:
          result.movedTasks > 0
            ? `${result.movedTasks} ${result.movedTasks === 1 ? "task was" : "tasks were"} moved to ${target?.name ?? "another column"}.`
            : undefined,
      });
      router.refresh();
    } catch (error) {
      toast.error("Could not delete column", {
        description: errorMessage(error),
      });
    }
  }

  async function deleteBoard() {
    try {
      await api(`/api/boards/${board.id}`, { method: "DELETE" });
      toast.success("Board deleted");
      setDeleteBoardOpen(false);
      router.push("/");
      router.refresh();
    } catch (error) {
      toast.error("Could not delete board", {
        description: errorMessage(error),
      });
    }
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as DragData | undefined;
    dragSnapshotRef.current = { tasks, columns };
    if (data?.type === "task") setActiveTaskId(data.taskId ?? null);
    if (data?.type === "column") setActiveColumnId(data.columnId ?? null);
  }

  function handleDragOver(event: DragOverEvent) {
    const activeData = event.active.data.current as DragData | undefined;
    if (activeData?.type !== "task" || !activeData.taskId) return;
    const overData = event.over?.data.current as DragData | undefined;
    const targetColumnId = overData?.columnId;
    if (!targetColumnId) return;
    const current = tasks.find((task) => task.id === activeData.taskId);
    if (!current || current.columnId === targetColumnId) return;

    setTasks((currentTasks) => {
      const currentTask = currentTasks.find(
        (task) => task.id === activeData.taskId,
      );
      if (!currentTask || currentTask.columnId === targetColumnId) {
        return currentTasks;
      }
      const targetTasks = getOrderedTasks(
        currentTasks,
        targetColumnId,
      ).filter((task) => task.id !== activeData.taskId);
      let index = targetTasks.length;
      if (overData?.type === "task" && overData.taskId) {
        const overIndex = targetTasks.findIndex(
          (task) => task.id === overData.taskId,
        );
        if (overIndex !== -1) index = overIndex;
      }
      return moveTaskToIndex(
        currentTasks,
        activeData.taskId!,
        targetColumnId,
        index,
      );
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeData = event.active.data.current as DragData | undefined;
    const snapshot = dragSnapshotRef.current;
    setActiveTaskId(null);
    setActiveColumnId(null);

    if (activeData?.type === "column" && activeData.columnId) {
      const overData = event.over?.data.current as DragData | undefined;
      if (
        overData?.type === "column" &&
        overData.columnId &&
        overData.columnId !== activeData.columnId
      ) {
        const next = moveColumn(columns, activeData.columnId, overData.columnId);
        void commitColumnOrder(next, columns);
      }
      dragSnapshotRef.current = null;
      return;
    }

    if (activeData?.type !== "task" || !activeData.taskId || !snapshot) {
      dragSnapshotRef.current = null;
      return;
    }

    const taskId = activeData.taskId;
    const current = tasks.find((task) => task.id === taskId);
    let nextTasks = tasks;

    if (event.over && String(event.over.id) !== taskId && current) {
      const overData = event.over.data.current as DragData | undefined;
      const targetColumnId = overData?.columnId ?? current.columnId;
      const targetTasks = getOrderedTasks(tasks, targetColumnId).filter(
        (task) => task.id !== taskId,
      );
      let index = targetTasks.length;
      if (overData?.type === "task" && overData.taskId) {
        const overIndex = targetTasks.findIndex(
          (task) => task.id === overData.taskId,
        );
        if (overIndex !== -1) index = overIndex;
      }
      nextTasks = moveTaskToIndex(tasks, taskId, targetColumnId, index);
    }

    setTasks(nextTasks);
    dragSnapshotRef.current = null;

    const previousPayload = buildTaskOrderPayload(snapshot.tasks, columns);
    const nextPayload = buildTaskOrderPayload(nextTasks, columns);
    if (JSON.stringify(previousPayload) === JSON.stringify(nextPayload)) {
      return;
    }

    const previousTask = snapshot.tasks.find((task) => task.id === taskId);
    const nextTask = nextTasks.find((task) => task.id === taskId);
    const movedAcrossColumns =
      previousTask && nextTask && previousTask.columnId !== nextTask.columnId;
    const targetColumn = nextTask
      ? columns.find((column) => column.id === nextTask.columnId)
      : undefined;

    void commitTaskOrder(
      nextTasks,
      snapshot.tasks,
      movedAcrossColumns ? targetColumn?.name : undefined,
    );
  }

  function handleDragCancel() {
    const snapshot = dragSnapshotRef.current;
    if (snapshot) {
      setTasks(snapshot.tasks);
      setColumns(snapshot.columns);
    }
    dragSnapshotRef.current = null;
    setActiveTaskId(null);
    setActiveColumnId(null);
  }

  const deleteColumnTaskCount = deleteColumnTarget
    ? tasks.filter((task) => task.columnId === deleteColumnTarget.id).length
    : 0;
  const deleteColumnTargetColumn = deleteColumnTarget
    ? columns.find((column) => column.id !== deleteColumnTarget.id)
    : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="shrink-0 border-b border-border/60 bg-background/65 backdrop-blur">
        <div className="px-4 pt-4 sm:px-6 sm:pt-5">
          <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground/65">
            <Link href="/" className="transition-colors hover:text-foreground">
              Workspace
            </Link>
            <ChevronRight className="size-3 opacity-50" />
            <span className="truncate">{board.name}</span>
          </div>

          <div className="mt-2 flex flex-wrap items-start gap-x-3 gap-y-3">
            <span
              className={cn(
                "mt-2 size-2.5 shrink-0 rounded-full",
                BOARD_COLOR_CLASS[board.color],
                "board-dot",
              )}
            />
            <div className="min-w-0 flex-1">
              <h1 className="font-display truncate text-[24px] leading-tight font-semibold tracking-[-0.03em] sm:text-[27px]">
                {board.name}
              </h1>
              {board.description && (
                <p className="mt-1 max-w-2xl truncate text-[12px] text-muted-foreground">
                  {board.description}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10.5px] text-muted-foreground/75">
                <span>
                  {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary/60 transition-all"
                      style={{ width: `${completion}%` }}
                    />
                  </span>
                  {completion}% complete
                </span>
                {overdueCount > 0 && (
                  <span className="text-rose-600 dark:text-rose-400">
                    {overdueCount} overdue
                  </span>
                )}
                {isReordering && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    Saving order…
                  </span>
                )}
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <div className="hidden items-center rounded-lg border border-border/80 bg-card/50 p-0.5 sm:flex">
                <button
                  type="button"
                  onClick={() => changeView("board")}
                  aria-pressed={view === "board"}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors",
                    view === "board"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <LayoutGrid className="size-3.5" />
                  Board
                </button>
                <button
                  type="button"
                  onClick={() => changeView("list")}
                  aria-pressed={view === "list"}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors",
                    view === "list"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <List className="size-3.5" />
                  List
                </button>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  setNewTaskColumnId(undefined);
                  setNewTaskOpen(true);
                }}
                title="New task (N)"
                className="h-8"
              >
                <Plus className="size-3.5" />
                <span className="hidden sm:inline">New task</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Board actions"
                    className="text-muted-foreground"
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                    <PencilLine />
                    Board settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setDeleteBoardOpen(true)}
                  >
                    <Trash2 />
                    Delete board
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        <div className="px-4 pt-3 pb-3 sm:px-6">
          <FilterBar
            filters={filters}
            onChange={setFilters}
            columns={columns}
            labels={labels}
            visibleCount={filteredTasks.length}
            totalCount={tasks.length}
          />
        </div>

        {view === "board" && reorderPaused && (
          <div className="flex items-center gap-2 border-t border-border/50 bg-muted/25 px-4 py-1.5 text-[10.5px] text-muted-foreground sm:px-6">
            <Info className="size-3" />
            {filtersActive
              ? "Filters are active"
              : "Cards are sorted automatically"}{" "}
            — reordering is paused.
            <button
              type="button"
              onClick={() => {
                if (filtersActive) {
                  setFilters({ ...EMPTY_FILTERS });
                } else {
                  setFilters({ ...filters, sort: "manual" });
                }
              }}
              className="font-medium text-primary hover:underline"
            >
              {filtersActive ? "Clear filters" : "Use manual order"}
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {view === "board" ? (
          <DndContext
            id="masar-board"
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div className="scrollbar-thin flex h-full snap-x snap-mandatory items-stretch gap-3 overflow-x-auto px-4 py-4 sm:snap-none sm:px-6">
              {columns.map((column, index) => (
                <BoardColumn
                  key={column.id}
                  column={column}
                  tasks={getFilteredColumnTasks(tasks, column.id, filters)}
                  totalTaskCount={getOrderedTasks(tasks, column.id).length}
                  columns={columns}
                  labels={labels}
                  filtersActive={filtersActive}
                  dragDisabled={dragDisabled}
                  canMoveLeft={index > 0}
                  canMoveRight={index < columns.length - 1}
                  onOpenNewTask={(columnId) => {
                    setNewTaskColumnId(columnId);
                    setNewTaskOpen(true);
                  }}
                  onCreateInline={createInlineTask}
                  onEditColumn={(target) => {
                    setEditingColumn(target);
                    setColumnDialogOpen(true);
                  }}
                  onToggleDone={(target) => void toggleColumnDone(target)}
                  onMoveColumn={moveColumnByDirection}
                  onDeleteColumn={(target) => setDeleteColumnTarget(target)}
                  onClearFilters={() => setFilters({ ...EMPTY_FILTERS })}
                  taskHandlers={{
                    onOpenTask: openTask,
                    onDuplicateTask: (task) => void duplicateTask(task),
                    onMoveTask: (taskId, columnId) =>
                      void moveTask(taskId, columnId),
                    onDeleteTask: (task) => setDeleteTaskTarget(task),
                  }}
                />
              ))}

              <button
                type="button"
                onClick={() => {
                  setEditingColumn(null);
                  setColumnDialogOpen(true);
                }}
                className="mt-0 flex h-10 w-[220px] shrink-0 items-center justify-center gap-2 self-start rounded-xl border border-dashed border-border/80 text-[12px] font-medium text-muted-foreground/70 transition-colors hover:border-border hover:bg-card/50 hover:text-foreground"
              >
                <Plus className="size-3.5" />
                Add column
              </button>
            </div>

            <DragOverlay
              dropAnimation={{
                duration: 180,
                easing: "cubic-bezier(0.18, 0.67, 0.6, 1.1)",
              }}
            >
              {activeTask ? (
                <TaskDragOverlay
                  task={activeTask}
                  labels={labels}
                  column={columns.find(
                    (column) => column.id === activeTask.columnId,
                  )}
                />
              ) : activeColumn ? (
                <ColumnDragOverlay
                  column={activeColumn}
                  count={getOrderedTasks(tasks, activeColumn.id).length}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          <BoardListView
            tasks={filteredTasks}
            columns={columns}
            labels={labels}
            filtered={filtersActive}
            onOpenTask={openTask}
            onClearFilters={() => setFilters({ ...EMPTY_FILTERS })}
          />
        )}
      </div>

      <NewTaskDialog
        open={newTaskOpen}
        onOpenChange={setNewTaskOpen}
        boardId={board.id}
        columns={columns}
        labels={labels}
        defaultColumnId={newTaskColumnId ?? defaultColumnId}
        onCreated={handleTaskCreated}
      />

      <ColumnFormDialog
        open={columnDialogOpen}
        onOpenChange={(open) => {
          setColumnDialogOpen(open);
          if (!open) setEditingColumn(null);
        }}
        boardId={board.id}
        column={editingColumn}
        onSaved={handleColumnSaved}
      />

      <BoardSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        board={board}
        onSaved={(saved) => {
          setBoard((current) => ({ ...current, ...saved }));
          router.refresh();
        }}
        onRequestDelete={() => {
          setSettingsOpen(false);
          setDeleteBoardOpen(true);
        }}
      />

      <TaskDetailSheet
        task={selectedTask}
        columns={columns}
        labels={labels}
        open={Boolean(selectedTask)}
        onOpenChange={handleSheetOpenChange}
        onTaskUpdated={handleTaskUpdated}
        onTaskDeleted={handleTaskDeletedFromSheet}
        onTaskDuplicated={handleTaskDuplicated}
        onLabelCreated={(label) =>
          setLabels((current) => [...current, label])
        }
      />

      <ConfirmDialog
        open={Boolean(deleteTaskTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTaskTarget(null);
        }}
        title="Delete this task?"
        description={
          <>
            <span className="font-medium text-foreground">
              {deleteTaskTarget?.title}
            </span>{" "}
            and its subtasks and comments will be permanently removed.
          </>
        }
        confirmLabel="Delete task"
        onConfirm={deleteTaskFromCard}
      />

      <ConfirmDialog
        open={Boolean(deleteColumnTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteColumnTarget(null);
        }}
        title={`Delete ${deleteColumnTarget?.name ?? "column"}?`}
        description={
          <>
            {deleteColumnTaskCount > 0 ? (
              <>
                Its {deleteColumnTaskCount}{" "}
                {deleteColumnTaskCount === 1 ? "task" : "tasks"} will be moved to{" "}
                <span className="font-medium text-foreground">
                  {deleteColumnTargetColumn?.name ?? "another column"}
                </span>
                . Nothing will be deleted.
              </>
            ) : (
              "This empty column will be removed from the board."
            )}
          </>
        }
        confirmLabel="Delete column"
        onConfirm={deleteColumn}
      />

      <ConfirmDialog
        open={deleteBoardOpen}
        onOpenChange={setDeleteBoardOpen}
        title={`Delete ${board.name}?`}
        description={
          <>
            All {tasks.length} {tasks.length === 1 ? "task" : "tasks"} across{" "}
            {columns.length} {columns.length === 1 ? "column" : "columns"} will
            be permanently deleted. This cannot be undone.
          </>
        }
        confirmLabel="Delete board"
        onConfirm={deleteBoard}
      />
    </div>
  );
}

function TaskDragOverlay({
  task,
  labels,
  column,
}: {
  task: Task;
  labels: Label[];
  column?: BoardColumnType;
}) {
  const taskLabels = task.labelIds
    .map((id) => labels.find((label) => label.id === id))
    .filter((label): label is Label => Boolean(label))
    .slice(0, 3);
  return (
    <div className="w-[300px] rotate-[1.5deg] cursor-grabbing rounded-xl border border-border/80 bg-card p-3 shadow-float">
      {taskLabels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {taskLabels.map((label) => (
            <LabelChip key={label.id} label={label} />
          ))}
        </div>
      )}
      <h4 className="text-[13px] leading-[1.4] font-medium text-foreground">
        {task.title}
      </h4>
      <div className="mt-2.5 flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2">
          <PriorityBars priority={task.priority} />
          <DueDateChip task={task} columnDone={column?.isDone} />
        </div>
        <AssigneeAvatar name={task.assignee} />
      </div>
    </div>
  );
}

function ColumnDragOverlay({
  column,
  count,
}: {
  column: BoardColumnType;
  count: number;
}) {
  return (
    <div className="w-[300px] rotate-[1deg] cursor-grabbing rounded-2xl border border-border/80 bg-muted/60 p-3 shadow-float backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-primary/60" />
        <span className="text-[12.5px] font-semibold">{column.name}</span>
        <span className="rounded-full bg-foreground/5 px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">
          {count}
        </span>
      </div>
    </div>
  );
}
