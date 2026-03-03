import { asc, desc, eq, gte, lte, and } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import { boards, columns, tasks } from "@/db/schema";
import type { BoardColor, Priority } from "@/lib/constants";
import { addDaysIso, todayIso } from "@/lib/dates";
import type { BoardStats, DashboardData } from "@/lib/types";
import { fetchBoardSummaries, fetchTasks } from "./queries";

export async function getDashboardData(
  database: AppDatabase = getDb(),
): Promise<DashboardData> {
  const [boardSummaries, allColumns, allTasks] = await Promise.all([
    fetchBoardSummaries(database),
    database.select().from(columns).orderBy(asc(columns.position)),
    fetchTasks(database),
  ]);

  const today = todayIso();
  const weekAhead = addDaysIso(today, 7);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const columnMap = new Map(allColumns.map((column) => [column.id, column]));
  const boardMap = new Map(boardSummaries.map((board) => [board.id, board]));

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
      task.completedAt && new Date(task.completedAt).getTime() >= sevenDaysAgo.getTime(),
  );

  const priorityCounts: Record<Priority, number> = {
    none: 0,
    low: 0,
    medium: 0,
    high: 0,
    urgent: 0,
  };
  for (const task of allTasks) priorityCounts[task.priority] += 1;

  const boardStats: BoardStats[] = boardSummaries.map((board) => {
    const boardTasks = allTasks.filter((task) => task.boardId === board.id);
    return {
      boardId: board.id,
      name: board.name,
      color: board.color,
      total: boardTasks.length,
      done: boardTasks.filter((task) => isDone(task.columnId)).length,
      open: boardTasks.filter((task) => !isDone(task.columnId)).length,
      overdue: boardTasks.filter(
        (task) =>
          !isDone(task.columnId) && task.dueDate && task.dueDate < today,
      ).length,
    };
  });

  const enrich = (task: (typeof allTasks)[number]) => {
    const column = columnMap.get(task.columnId);
    const board = boardMap.get(task.boardId);
    return {
      ...task,
      boardName: board?.name ?? "Unknown board",
      boardColor: (board?.color ?? "slate") as BoardColor,
      columnName: column?.name ?? "Unknown",
      columnIsDone: column?.isDone ?? false,
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
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6)
    .map(enrich);

  return {
    totals: {
      tasks: allTasks.length,
      done: doneTasks.length,
      open: openTasks.length,
      overdue: overdueTasks.length,
      dueSoon: dueSoonTasks.length,
      completedLast7Days: completedLast7Days.length,
      boards: boardSummaries.length,
    },
    priorityCounts,
    boardStats,
    upcoming,
    recent,
  };
}

export async function getBoardUpcomingCounts(
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
  limit = 5,
  database: AppDatabase = getDb(),
) {
  const rows = await database
    .select()
    .from(tasks)
    .orderBy(desc(tasks.updatedAt))
    .limit(limit);
  return rows;
}
