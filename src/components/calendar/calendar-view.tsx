"use client";

import * as React from "react";
import { Link } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  addDays,
  addMonths,
  addWeeks,
} from "date-fns";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Columns3,
  PanelRightOpen,
  Rows3,
} from "lucide-react";
import { toast } from "sonner";

import { CalendarDayView } from "@/components/calendar/calendar-day-view";
import { CalendarMonthView } from "@/components/calendar/calendar-month-view";
import {
  CalendarTaskDragOverlay,
} from "@/components/calendar/calendar-task-chip";
import { CalendarWeekView } from "@/components/calendar/calendar-week-view";
import { UnscheduledPanel } from "@/components/calendar/unscheduled-panel";
import { TaskDetailSheet } from "@/components/board/task-detail-sheet";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CALENDAR_VIEWS,
  formatCalendarPeriod,
  groupTasksByDueDate,
  sortCalendarTasks,
  type CalendarTask,
  type CalendarViewMode,
} from "@/lib/calendar";
import { api, errorMessage } from "@/lib/client-api";
import type { BoardColor } from "@/lib/constants";
import { formatDueDate, todayIso } from "@/lib/dates";
import type { CalendarData, Label, Task, TaskDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

const VIEW_STORAGE_KEY = "masar:calendar-view";

type CalendarDragData =
  | { type: "calendar-task"; taskId: string; dueDate: string | null }
  | { type: "calendar-day"; date: string }
  | { type: "calendar-unscheduled" };

function readStoredView(): CalendarViewMode {
  if (typeof window === "undefined") return "month";
  const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
  return CALENDAR_VIEWS.includes(stored as CalendarViewMode)
    ? (stored as CalendarViewMode)
    : "month";
}

export function CalendarView({ initialData }: { initialData: CalendarData }) {
  const { refreshBoards, projects } = useWorkspace();
  const [tasks, setTasks] = React.useState<Task[]>(initialData.tasks);
  const [labels, setLabels] = React.useState<Label[]>(initialData.labels);
  const [cursor, setCursor] = React.useState<Date>(() => new Date());
  const [view, setView] = React.useState<CalendarViewMode>(readStoredView);
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(
    null,
  );
  const [activeTaskId, setActiveTaskId] = React.useState<string | null>(null);
  const [desktopPanelCollapsed, setDesktopPanelCollapsed] =
    React.useState(false);
  const [mobilePanelOpen, setMobilePanelOpen] = React.useState(false);
  const dueDateVersionRef = React.useRef(new Map<string, number>());

  const boardMap = React.useMemo(
    () => new Map(initialData.boards.map((board) => [board.id, board])),
    [initialData.boards],
  );
  const columnMap = React.useMemo(
    () => new Map(initialData.columns.map((column) => [column.id, column])),
    [initialData.columns],
  );

  const calendarTasks = React.useMemo<CalendarTask[]>(
    () =>
      tasks.map((task) => {
        const board = boardMap.get(task.boardId);
        const column = columnMap.get(task.columnId);
        return {
          ...task,
          boardName: board?.name ?? "Unknown board",
          boardColor: (board?.color ?? "slate") as BoardColor,
          columnName: column?.name ?? "Unknown",
          columnDone: column?.isDone ?? false,
        };
      }),
    [tasks, boardMap, columnMap],
  );

  const scheduledTasks = React.useMemo(
    () =>
      sortCalendarTasks(calendarTasks.filter((task) => Boolean(task.dueDate))),
    [calendarTasks],
  );
  const unscheduledTasks = React.useMemo(
    () =>
      sortCalendarTasks(calendarTasks.filter((task) => !task.dueDate)),
    [calendarTasks],
  );
  const tasksByDate = React.useMemo(() => {
    const grouped = groupTasksByDueDate(scheduledTasks);
    for (const [date, list] of grouped) {
      grouped.set(date, sortCalendarTasks(list));
    }
    return grouped;
  }, [scheduledTasks]);

  const selectedTask =
    tasks.find((task) => task.id === selectedTaskId) ?? null;
  const activeTask =
    calendarTasks.find((task) => task.id === activeTaskId) ?? null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const collisionDetection = React.useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    return pointerCollisions.length > 0
      ? pointerCollisions
      : closestCenter(args);
  }, []);

  function changeView(next: CalendarViewMode) {
    setView(next);
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
  }

  function openTask(taskId: string) {
    setSelectedTaskId(taskId);
  }

  function openDay(date: Date) {
    setCursor(date);
    changeView("day");
  }

  function shiftPeriod(direction: -1 | 1) {
    setCursor((current) => {
      if (view === "month") return addMonths(current, direction);
      if (view === "week") return addWeeks(current, direction);
      return addDays(current, direction);
    });
  }

  function goToToday() {
    setCursor(new Date());
  }

  async function updateTaskDueDate(taskId: string, dueDate: string | null) {
    const current = tasks.find((task) => task.id === taskId);
    if (!current || current.dueDate === dueDate) return;

    const previousDueDate = current.dueDate;
    const version = (dueDateVersionRef.current.get(taskId) ?? 0) + 1;
    dueDateVersionRef.current.set(taskId, version);
    const isLatest = () =>
      dueDateVersionRef.current.get(taskId) === version;

    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.id === taskId ? { ...task, dueDate } : task,
      ),
    );

    try {
      const { task: updated } = await api<{ task: TaskDetail }>(
        `/api/tasks/${taskId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ dueDate }),
        },
      );
      if (!isLatest()) return;
      setTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.id === taskId ? { ...task, ...updated } : task,
        ),
      );

      if (!dueDate) {
        toast.success("Moved to Unscheduled", {
          description: current.title,
        });
      } else {
        const formatted = formatDueDate(dueDate);
        toast.success(
          previousDueDate ? "Due date updated" : "Task scheduled",
          {
            description: `${current.title}${formatted ? ` · ${formatted}` : ""}`,
          },
        );
      }
    } catch (error) {
      if (isLatest()) {
        setTasks((currentTasks) =>
          currentTasks.map((task) =>
            task.id === taskId
              ? { ...task, dueDate: previousDueDate }
              : task,
          ),
        );
      }
      toast.error("Could not update the due date", {
        description: errorMessage(error),
      });
    }
  }

  function handleTaskUpdated(updated: Task) {
    const previous = tasks.find((task) => task.id === updated.id);
    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.id === updated.id ? { ...task, ...updated } : task,
      ),
    );
    if (previous && previous.columnId !== updated.columnId) {
      void refreshBoards();
    }
  }

  function handleTaskDeleted(taskId: string) {
    setTasks((currentTasks) =>
      currentTasks.filter((task) => task.id !== taskId),
    );
    setSelectedTaskId(null);
    void refreshBoards();
  }

  function handleTaskDuplicated(task: Task) {
    setTasks((currentTasks) =>
      currentTasks.some((item) => item.id === task.id)
        ? currentTasks
        : [...currentTasks, task],
    );
    void refreshBoards();
  }

  function handleLabelCreated(label: Label) {
    setLabels((current) =>
      current.some((item) => item.id === label.id)
        ? current
        : [...current, label],
    );
  }

  function handleSheetOpenChange(open: boolean) {
    if (!open) setSelectedTaskId(null);
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as CalendarDragData | undefined;
    if (data?.type === "calendar-task") {
      setActiveTaskId(data.taskId);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeData = event.active.data.current as
      | CalendarDragData
      | undefined;
    const overData = event.over?.data.current as CalendarDragData | undefined;
    setActiveTaskId(null);

    if (activeData?.type !== "calendar-task") return;
    if (overData?.type === "calendar-day") {
      void updateTaskDueDate(activeData.taskId, overData.date);
    } else if (overData?.type === "calendar-unscheduled") {
      void updateTaskDueDate(activeData.taskId, null);
    }
  }

  function handleDragCancel() {
    setActiveTaskId(null);
  }

  const periodLabel = formatCalendarPeriod(view, cursor);
  const selectedBoardColumns = selectedTask
    ? initialData.columns.filter(
        (column) => column.boardId === selectedTask.boardId,
      )
    : [];
  const selectedBoardLabels = selectedTask
    ? labels.filter((label) => label.boardId === selectedTask.boardId)
    : [];
  const selectedTaskReadOnly = selectedTask
    ? (projects.find(
        (project) => project.id === boardMap.get(selectedTask.boardId)?.projectId,
      )?.archived ?? false)
    : false;

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="shrink-0 border-b border-border/60 bg-background/65 backdrop-blur">
        <div className="px-4 pt-4 sm:px-6 sm:pt-5">
          <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground/65">
            <Link to="/" className="transition-colors hover:text-foreground">
              Workspace
            </Link>
            <ChevronRight className="size-3 opacity-50" />
            <span>Calendar</span>
          </div>

          <div className="mt-2 flex flex-wrap items-start gap-x-3 gap-y-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <CalendarDays className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="font-display truncate text-[24px] leading-tight font-semibold tracking-[-0.03em] sm:text-[27px]">
                Calendar
              </h1>
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                {scheduledTasks.length} scheduled · {unscheduledTasks.length}{" "}
                unscheduled
              </p>
            </div>

            <div className="ml-auto flex items-center rounded-lg border border-border/80 bg-card/50 p-0.5">
              <ViewModeButton
                active={view === "month"}
                onClick={() => changeView("month")}
                icon={CalendarDays}
                label="Month"
              />
              <ViewModeButton
                active={view === "week"}
                onClick={() => changeView("week")}
                icon={Columns3}
                label="Week"
              />
              <ViewModeButton
                active={view === "day"}
                onClick={() => changeView("day")}
                icon={Rows3}
                label="Day"
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 pb-3">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-xs"
                onClick={() => shiftPeriod(-1)}
                aria-label={`Previous ${view}`}
                title={`Previous ${view}`}
                className="bg-card/60"
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <span
                aria-live="polite"
                className="min-w-[128px] text-center text-[12px] font-semibold tracking-[-0.01em] text-foreground/85 sm:min-w-[150px]"
              >
                {periodLabel}
              </span>
              <Button
                variant="outline"
                size="icon-xs"
                onClick={() => shiftPeriod(1)}
                aria-label={`Next ${view}`}
                title={`Next ${view}`}
                className="bg-card/60"
              >
                <ChevronRight className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={goToToday}
                className="ml-1 text-[11px]"
              >
                Today
              </Button>
            </div>

            <div className="ml-auto hidden items-center gap-3 text-[10px] text-muted-foreground/65 sm:flex">
              <LegendDot className="bg-rose-500" label="Overdue" />
              <LegendDot className="bg-amber-500" label="Today" />
              <LegendDot className="bg-emerald-500" label="Completed" />
              <LegendDot className="bg-sky-500" label="Upcoming" />
            </div>
          </div>
        </div>
      </div>

      <DndContext
        id="masar-calendar"
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-border/60 lg:hidden">
              <UnscheduledPanel
                tasks={unscheduledTasks}
                open={mobilePanelOpen}
                onToggle={() => setMobilePanelOpen((open) => !open)}
                onOpenTask={openTask}
              />
            </div>

            <div className="min-h-0 flex-1">
              {view === "month" && (
                <CalendarMonthView
                  cursor={cursor}
                  tasksByDate={tasksByDate}
                  onOpenTask={openTask}
                  onOpenDay={openDay}
                />
              )}
              {view === "week" && (
                <CalendarWeekView
                  cursor={cursor}
                  tasksByDate={tasksByDate}
                  onOpenTask={openTask}
                  onOpenDay={openDay}
                />
              )}
              {view === "day" && (
                <CalendarDayView
                  cursor={cursor}
                  tasks={tasksByDate.get(todayIso(cursor)) ?? []}
                  onOpenTask={openTask}
                />
              )}
            </div>
          </div>

          <aside
            className={cn(
              "hidden shrink-0 border-l border-border/60 transition-[width] duration-200 lg:flex",
              desktopPanelCollapsed ? "w-12" : "w-[292px]",
            )}
          >
            {desktopPanelCollapsed ? (
              <button
                type="button"
                onClick={() => setDesktopPanelCollapsed(false)}
                aria-label={`Expand unscheduled tasks (${unscheduledTasks.length})`}
                className="flex h-full w-full flex-col items-center gap-3 bg-background/35 px-1 py-4 text-muted-foreground/60 transition-colors hover:bg-accent/40 hover:text-foreground"
              >
                <PanelRightOpen className="size-4" />
                <span className="text-[9.5px] font-semibold tracking-[0.16em] uppercase [writing-mode:vertical-rl]">
                  Unscheduled
                </span>
                <Badge
                  variant="muted"
                  className="px-1.5 text-[9.5px] tabular-nums"
                >
                  {unscheduledTasks.length}
                </Badge>
              </button>
            ) : (
              <UnscheduledPanel
                tasks={unscheduledTasks}
                open
                onToggle={() => setDesktopPanelCollapsed(true)}
                onOpenTask={openTask}
              />
            )}
          </aside>
        </div>

        <DragOverlay
          dropAnimation={{
            duration: 180,
            easing: "cubic-bezier(0.18, 0.67, 0.6, 1.1)",
          }}
        >
          {activeTask ? <CalendarTaskDragOverlay task={activeTask} /> : null}
        </DragOverlay>
      </DndContext>

      <TaskDetailSheet
        task={selectedTask}
        columns={selectedBoardColumns}
        labels={selectedBoardLabels}
        open={Boolean(selectedTask)}
        readOnly={selectedTaskReadOnly}
        onOpenChange={handleSheetOpenChange}
        onTaskUpdated={handleTaskUpdated}
        onTaskDeleted={handleTaskDeleted}
        onTaskDuplicated={handleTaskDuplicated}
        onLabelCreated={handleLabelCreated}
      />
    </div>
  );
}

function ViewModeButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

function LegendDot({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("size-1.5 rounded-full", className)} />
      {label}
    </span>
  );
}
