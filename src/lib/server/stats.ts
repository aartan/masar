import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import { boards, columns, notes, tasks, whiteboards } from "@/db/schema";
import {
  TASK_COMPLEXITIES,
  TASK_COMPLEXITY_META,
  type Priority,
  type TaskComplexity,
} from "@/lib/constants";
import { addDaysIso, todayIso } from "@/lib/dates";
import type {
  ActivityItem,
  BoardStats,
  DashboardData,
  DashboardTask,
} from "@/lib/types";
import { fetchBoardSummaries, fetchProjectSummaries, fetchTasks } from "./queries";

export async function getDashboardData(
  ownerId: string,
  database: AppDatabase = getDb(),
  projectId?: string,
): Promise<DashboardData> {
  const [allBoardSummaries, allProjectSummaries] = await Promise.all([
    fetchBoardSummaries(database, ownerId),
    fetchProjectSummaries(database, ownerId),
  ]);
  const activeProjectIds = new Set(
    allProjectSummaries
      .filter((project) => !project.archived)
      .map((project) => project.id),
  );
  const boardSummaries = projectId
    ? allBoardSummaries.filter((board) => board.projectId === projectId)
    : allBoardSummaries.filter(
        (board) => !board.projectId || activeProjectIds.has(board.projectId),
      );
  const boardIds = boardSummaries.map((board) => board.id);
  const projectSummaries = projectId
    ? allProjectSummaries.filter((project) => project.id === projectId)
    : allProjectSummaries.filter((project) => !project.archived);

  const [allColumns, allOwnerTasks, whiteboardRows, noteRows] = await Promise.all([
    boardIds.length > 0
      ? database
          .select()
          .from(columns)
          .where(inArray(columns.boardId, boardIds))
          .orderBy(asc(columns.position))
      : Promise.resolve([]),
    fetchTasks(database, { ownerId }),
    boardIds.length > 0
      ? database
          .select({
            boardId: whiteboards.boardId,
            updatedAt: whiteboards.updatedAt,
          })
          .from(whiteboards)
          .where(inArray(whiteboards.boardId, boardIds))
          .orderBy(desc(whiteboards.updatedAt))
          .limit(20)
      : Promise.resolve([]),
    boardIds.length > 0
      ? database
          .select({
            boardId: notes.boardId,
            updatedAt: notes.updatedAt,
          })
          .from(notes)
          .where(inArray(notes.boardId, boardIds))
          .orderBy(desc(notes.updatedAt))
          .limit(20)
      : Promise.resolve([]),
  ]);

  const allTasks = allOwnerTasks.filter((task) =>
    boardIds.includes(task.boardId),
  );
  const today = todayIso();
  const weekAhead = addDaysIso(today, 7);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const columnMap = new Map(allColumns.map((column) => [column.id, column]));
  const boardMap = new Map(boardSummaries.map((board) => [board.id, board]));
  const projectMap = new Map(
    projectSummaries.map((project) => [project.id, project]),
  );

  const isDone = (columnId: string) => columnMap.get(columnId)?.isDone ?? false;
  const doneTasks = allTasks.filter((task) => isDone(task.columnId));
  const openTasks = allTasks.filter((task) => !isDone(task.columnId));
  const overdueTasks = openTasks.filter(
    (task) => task.dueDate && task.dueDate < today,
  );
  const dueSoonTasks = openTasks.filter(
    (task) =>
      task.dueDate && task.dueDate >= today && task.dueDate <= weekAhead,
  );
  const completedLast7Days = doneTasks.filter(
    (task) =>
      task.completedAt &&
      new Date(task.completedAt).getTime() >= sevenDaysAgo.getTime(),
  );

  const priorityCounts: Record<Priority, number> = {
    none: 0,
    low: 0,
    medium: 0,
    high: 0,
    urgent: 0,
  };
  for (const task of allTasks) priorityCounts[task.priority] += 1;

  const sizeCounts = Object.fromEntries(
    TASK_COMPLEXITIES.map((complexity) => [complexity, 0]),
  ) as Record<TaskComplexity, number>;
  const effortPointsBySize = Object.fromEntries(
    TASK_COMPLEXITIES.map((complexity) => [complexity, 0]),
  ) as Record<TaskComplexity, number>;
  let totalEffort = 0;
  let unestimatedTasks = 0;
  for (const task of allTasks) {
    const complexity = task.complexity;
    const meta = complexity ? TASK_COMPLEXITY_META[complexity] : null;
    if (!complexity || !meta) {
      unestimatedTasks += 1;
      continue;
    }
    const effortPoints = meta.effortPoints;
    sizeCounts[complexity] += 1;
    effortPointsBySize[complexity] += effortPoints;
    totalEffort += effortPoints;
  }

  const boardStats: BoardStats[] = boardSummaries.map((board) => {
    const boardTasks = allTasks.filter((task) => task.boardId === board.id);
    return {
      boardId: board.id,
      name: board.name,
      total: boardTasks.length,
      done: boardTasks.filter((task) => isDone(task.columnId)).length,
      open: boardTasks.filter((task) => !isDone(task.columnId)).length,
      overdue: boardTasks.filter(
        (task) =>
          !isDone(task.columnId) && task.dueDate && task.dueDate < today,
      ).length,
    };
  });

  const enrich = (task: (typeof allTasks)[number]): DashboardTask => {
    const column = columnMap.get(task.columnId);
    const board = boardMap.get(task.boardId);
    const project = board?.projectId
      ? projectMap.get(board.projectId)
      : undefined;
    return {
      ...task,
      boardName: board?.name ?? "Unknown board",
      columnName: column?.name ?? "Unknown",
      columnIsDone: column?.isDone ?? false,
      projectId: board?.projectId ?? null,
      projectName: project?.name ?? null,
    };
  };

  const upcoming = openTasks
    .filter((task) => task.dueDate !== null)
    .sort(
      (a, b) =>
        (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
        a.position - b.position,
    )
    .slice(0, 6)
    .map(enrich);

  const recent = [...allTasks]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6)
    .map(enrich);

  const activity: ActivityItem[] = [];
  for (const task of [...allTasks]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 12)) {
    const board = boardMap.get(task.boardId);
    if (!board) continue;
    const project = board.projectId ? projectMap.get(board.projectId) : undefined;
    activity.push({
      id: `task:${task.id}`,
      kind: "task",
      title: task.title,
      detail:
        columnMap.get(task.columnId)?.isDone === true
          ? "Completed"
          : columnMap.get(task.columnId)?.name ?? null,
      boardId: board.id,
      boardName: board.name,
      boardType: board.type,
      projectId: board.projectId,
      projectName: project?.name ?? null,
      timestamp: task.updatedAt,
    });
  }
  for (const row of whiteboardRows) {
    const board = boardMap.get(row.boardId);
    if (!board) continue;
    const project = board.projectId ? projectMap.get(board.projectId) : undefined;
    activity.push({
      id: `whiteboard:${row.boardId}`,
      kind: "whiteboard",
      title: board.name,
      detail: "Whiteboard saved",
      boardId: board.id,
      boardName: board.name,
      boardType: board.type,
      projectId: board.projectId,
      projectName: project?.name ?? null,
      timestamp: row.updatedAt.toISOString(),
    });
  }
  for (const row of noteRows) {
    const board = boardMap.get(row.boardId);
    if (!board) continue;
    const project = board.projectId ? projectMap.get(board.projectId) : undefined;
    activity.push({
      id: `note:${row.boardId}`,
      kind: "note",
      title: board.name,
      detail: "Note updated",
      boardId: board.id,
      boardName: board.name,
      boardType: board.type,
      projectId: board.projectId,
      projectName: project?.name ?? null,
      timestamp: row.updatedAt.toISOString(),
    });
  }
  activity.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return {
    totals: {
      tasks: allTasks.length,
      done: doneTasks.length,
      open: openTasks.length,
      overdue: overdueTasks.length,
      dueSoon: dueSoonTasks.length,
      completedLast7Days: completedLast7Days.length,
      boards: boardSummaries.length,
      projects: projectSummaries.length,
      whiteboards: boardSummaries.filter(
        (board) => board.type === "whiteboard",
      ).length,
      notes: boardSummaries.filter((board) => board.type === "note").length,
      totalEffort,
      unestimatedTasks,
    },
    priorityCounts,
    sizeCounts,
    effortPointsBySize,
    boardStats,
    projects: projectSummaries,
    activity: activity.slice(0, 10),
    upcoming,
    recent,
  };
}

export async function getBoardUpcomingCounts(
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<Map<string, number>> {
  const today = todayIso();
  const weekAhead = addDaysIso(today, 7);
  const rows = await database
    .select({ boardId: tasks.boardId, id: tasks.id })
    .from(tasks)
    .innerJoin(columns, eq(tasks.columnId, columns.id))
    .innerJoin(boards, eq(tasks.boardId, boards.id))
    .where(
      and(
        eq(boards.ownerId, ownerId),
        eq(columns.isDone, false),
        gte(tasks.dueDate, today),
        lte(tasks.dueDate, weekAhead),
      ),
    );
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.boardId, (map.get(row.boardId) ?? 0) + 1);
  }
  return map;
}

export async function getRecentTasks(
  ownerId: string,
  limit = 5,
  database: AppDatabase = getDb(),
) {
  const rows = await database
    .select()
    .from(tasks)
    .where(
      inArray(
        tasks.boardId,
        database
          .select({ id: boards.id })
          .from(boards)
          .where(eq(boards.ownerId, ownerId)),
      ),
    )
    .orderBy(desc(tasks.updatedAt))
    .limit(limit);
  return rows;
}
