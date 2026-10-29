import { PRIORITY_META, type Priority } from "@/lib/constants";
import type { BoardColumn, Task } from "@/lib/types";
import { dueDayDelta, todayIso } from "@/lib/dates";

export function getOrderedTasks(tasks: Task[], columnId: string): Task[] {
  return tasks
    .filter((task) => task.columnId === columnId)
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
}

export function groupTasksByColumn(
  tasks: Task[],
  columns: BoardColumn[],
): Record<string, Task[]> {
  const grouped: Record<string, Task[]> = {};
  for (const column of columns) {
    grouped[column.id] = getOrderedTasks(tasks, column.id);
  }
  return grouped;
}

/**
 * Move a task to a target index within a column. Positions are normalized
 * across every column after the move so the persisted order is deterministic.
 */
export function moveTaskToIndex(
  tasks: Task[],
  taskId: string,
  targetColumnId: string,
  targetIndex: number,
): Task[] {
  const active = tasks.find((task) => task.id === taskId);
  if (!active) return tasks;

  const columnIds = Array.from(new Set(tasks.map((task) => task.columnId)));
  if (!columnIds.includes(targetColumnId)) columnIds.push(targetColumnId);

  const ordered = new Map<string, Task[]>();
  for (const columnId of columnIds) {
    ordered.set(columnId, getOrderedTasks(tasks, columnId));
  }

  const sourceList = ordered.get(active.columnId);
  if (sourceList) {
    const index = sourceList.findIndex((task) => task.id === taskId);
    if (index !== -1) sourceList.splice(index, 1);
  }

  const targetList = ordered.get(targetColumnId) ?? [];
  const clampedIndex = Math.max(0, Math.min(targetIndex, targetList.length));
  targetList.splice(clampedIndex, 0, { ...active, columnId: targetColumnId });
  ordered.set(targetColumnId, targetList);

  const result: Task[] = [];
  for (const [columnId, list] of ordered) {
    list.forEach((task, index) => {
      result.push({ ...task, columnId, position: index });
    });
  }
  return result;
}

export function moveTaskToColumnEnd(
  tasks: Task[],
  taskId: string,
  targetColumnId: string,
): Task[] {
  const active = tasks.find((task) => task.id === taskId);
  if (!active) return tasks;
  if (active.columnId === targetColumnId) {
    const targetTasks = getOrderedTasks(tasks, targetColumnId);
    if (targetTasks[targetTasks.length - 1]?.id === taskId) return tasks;
  }
  const targetCount = tasks.filter(
    (task) => task.columnId === targetColumnId,
  ).length;
  return moveTaskToIndex(tasks, taskId, targetColumnId, targetCount);
}

/**
 * Drops a task onto another task. Tasks already in the target column follow
 * dnd-kit's array-move behaviour, so the dragged task lands at the over task's
 * index. Tasks entering the column are inserted directly before the over task.
 */
export function moveTaskOverTask(
  tasks: Task[],
  taskId: string,
  targetColumnId: string,
  overTaskId: string,
): Task[] {
  const targetTasks = getOrderedTasks(tasks, targetColumnId);
  const overIndex = targetTasks.findIndex((task) => task.id === overTaskId);
  if (overIndex === -1) {
    return moveTaskToColumnEnd(tasks, taskId, targetColumnId);
  }
  const activeIndex = targetTasks.findIndex((task) => task.id === taskId);
  if (activeIndex === overIndex) return tasks;
  return moveTaskToIndex(tasks, taskId, targetColumnId, overIndex);
}

export function buildTaskOrderPayload(
  tasks: Task[],
  columns: BoardColumn[],
): { columns: Array<{ columnId: string; taskIds: string[] }> } {
  return {
    columns: columns.map((column) => ({
      columnId: column.id,
      taskIds: getOrderedTasks(tasks, column.id).map((task) => task.id),
    })),
  };
}

export function moveColumn(
  columns: BoardColumn[],
  activeId: string,
  overId: string,
): BoardColumn[] {
  const oldIndex = columns.findIndex((column) => column.id === activeId);
  const newIndex = columns.findIndex((column) => column.id === overId);
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
    return columns;
  }
  const next = [...columns];
  const [moved] = next.splice(oldIndex, 1);
  if (!moved) return columns;
  next.splice(newIndex, 0, moved);
  return next.map((column, index) => ({ ...column, position: index }));
}

export interface TaskFilters {
  query: string;
  priorities: Priority[];
  labelIds: string[];
  due: "any" | "overdue" | "today" | "week" | "none";
  columnId: string | null;
  sort: "manual" | "due" | "priority" | "newest";
}

export const EMPTY_FILTERS: TaskFilters = {
  query: "",
  priorities: [],
  labelIds: [],
  due: "any",
  columnId: null,
  sort: "manual",
};

export function hasActiveFilters(filters: TaskFilters): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.priorities.length > 0 ||
    filters.labelIds.length > 0 ||
    filters.due !== "any" ||
    filters.columnId !== null
  );
}

export function matchesFilters(
  task: Task,
  filters: TaskFilters,
  referenceIso = todayIso(),
): boolean {
  const query = filters.query.trim().toLowerCase();
  if (query) {
    const haystack = `${task.title}\n${task.description ?? ""}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (
    filters.priorities.length > 0 &&
    !filters.priorities.includes(task.priority)
  ) {
    return false;
  }
  if (
    filters.labelIds.length > 0 &&
    !filters.labelIds.some((id) => task.labelIds.includes(id))
  ) {
    return false;
  }
  if (filters.columnId && task.columnId !== filters.columnId) return false;

  if (filters.due !== "any") {
    if (filters.due === "none" && task.dueDate) return false;
    if (filters.due !== "none" && !task.dueDate) return false;
    if (filters.due === "overdue") {
      if (!(task.dueDate && task.dueDate < referenceIso)) return false;
    }
    if (filters.due === "today") {
      if (task.dueDate !== referenceIso) return false;
    }
    if (filters.due === "week") {
      if (!task.dueDate) return false;
      const delta = dueDayDelta(task.dueDate, referenceIso);
      if (delta < 0 || delta > 7) return false;
    }
  }

  return true;
}

export function sortTasks(tasks: Task[], sort: TaskFilters["sort"]): Task[] {
  const sorted = [...tasks];
  if (sort === "due") {
    sorted.sort((a, b) => {
      if (a.dueDate === b.dueDate) {
        return (
          PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank
        );
      }
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  } else if (sort === "priority") {
    sorted.sort(
      (a, b) =>
        PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank ||
        (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
    );
  } else if (sort === "newest") {
    sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } else {
    sorted.sort((a, b) => a.position - b.position);
  }
  return sorted;
}

export function filterAndSortTasks(
  tasks: Task[],
  filters: TaskFilters,
  referenceIso = todayIso(),
): Task[] {
  return sortTasks(
    tasks.filter((task) => matchesFilters(task, filters, referenceIso)),
    filters.sort,
  );
}

export function getFilteredColumnTasks(
  tasks: Task[],
  columnId: string,
  filters: TaskFilters,
  referenceIso = todayIso(),
): Task[] {
  return sortTasks(
    tasks.filter(
      (task) =>
        task.columnId === columnId &&
        matchesFilters(task, filters, referenceIso),
    ),
    filters.sort,
  );
}

export function completionPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}
