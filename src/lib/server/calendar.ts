import { asc, eq, inArray } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import { boards, columns, labels } from "@/db/schema";
import type { CalendarData } from "@/lib/types";
import {
  fetchBoardSummaries,
  fetchTasks,
  serializeColumn,
  serializeLabel,
} from "./queries";

/**
 * Read-only aggregate used by the calendar view. It intentionally reuses the
 * existing board/task queries instead of introducing a second task store.
 */
export async function getCalendarData(
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<CalendarData> {
  const ownedBoardIds = database
    .select({ id: boards.id })
    .from(boards)
    .where(eq(boards.ownerId, ownerId));

  const [boardRows, columnRows, labelRows, taskRows] = await Promise.all([
    fetchBoardSummaries(database, ownerId),
    database
      .select()
      .from(columns)
      .where(inArray(columns.boardId, ownedBoardIds))
      .orderBy(asc(columns.boardId), asc(columns.position)),
    database
      .select()
      .from(labels)
      .where(inArray(labels.boardId, ownedBoardIds))
      .orderBy(asc(labels.createdAt)),
    fetchTasks(database, { ownerId }),
  ]);

  return {
    boards: boardRows,
    columns: columnRows.map(serializeColumn),
    labels: labelRows.map(serializeLabel),
    tasks: taskRows,
  };
}
