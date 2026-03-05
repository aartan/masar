import { eq, or, sql } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import { boards, columns, tasks } from "@/db/schema";
import type { BoardColor, Priority } from "@/lib/constants";
import type { SearchResult } from "@/lib/types";

export async function searchTasks(
  query: string,
  limit = 20,
  database: AppDatabase = getDb(),
): Promise<SearchResult[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  const pattern = `%${normalized}%`;

  const rows = await database
    .select({
      taskId: tasks.id,
      title: tasks.title,
      boardId: boards.id,
      boardName: boards.name,
      boardColor: boards.color,
      columnName: columns.name,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
    })
    .from(tasks)
    .innerJoin(boards, eq(tasks.boardId, boards.id))
    .innerJoin(columns, eq(tasks.columnId, columns.id))
    .where(
      or(
        sql`lower(${tasks.title}) like lower(${pattern})`,
        sql`lower(coalesce(${tasks.description}, '')) like lower(${pattern})`,
      ),
    )
    .orderBy(sql`case when ${tasks.dueDate} is null then 1 else 0 end`, tasks.dueDate)
    .limit(limit);

  return rows.map((row) => ({
    taskId: row.taskId,
    title: row.title,
    boardId: row.boardId,
    boardName: row.boardName,
    boardColor: row.boardColor as BoardColor,
    columnName: row.columnName,
    priority: row.priority as Priority,
    dueDate: row.dueDate,
  }));
}

export async function countSearchMatches(
  query: string,
  database: AppDatabase = getDb(),
): Promise<number> {
  const normalized = query.trim();
  if (!normalized) return 0;
  const pattern = `%${normalized}%`;
  const [row] = await database
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(tasks)
    .where(
      or(
        sql`lower(${tasks.title}) like lower(${pattern})`,
        sql`lower(coalesce(${tasks.description}, '')) like lower(${pattern})`,
      ),
    );
  return row?.value ?? 0;
}
