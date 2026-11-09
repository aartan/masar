import { createClient, type Client, type Transaction } from "@libsql/client";

import { getClient } from "@/db";
import { ApiError } from "@/lib/api";
import { LOCAL_USER_ID } from "@/lib/server/desktop";

export interface ImportLocalResult {
  boards: number;
  tasks: number;
}

/**
 * FK-safe copy order. Each entry maps a workspace table to the columns copied
 * from the local database. `task_labels` has no id column; the other tables
 * keep their original ids so a repeated import is a no-op.
 */
const TABLES = [
  {
    table: "projects",
    columns:
      "id, owner_id, name, position, archived, archived_at, created_at, updated_at",
  },
  {
    table: "boards",
    columns:
      "id, owner_id, project_id, type, name, description, color, position, created_at, updated_at",
  },
  {
    table: "columns",
    columns: "id, board_id, name, position, is_done, created_at, updated_at",
  },
  {
    table: "labels",
    columns: "id, board_id, name, color, created_at, updated_at",
  },
  {
    table: "tasks",
    columns:
      "id, board_id, column_id, title, description, priority, due_date, assignee, position, completed_at, created_at, updated_at",
  },
  { table: "task_labels", columns: "task_id, label_id" },
  {
    table: "subtasks",
    columns: "id, task_id, title, completed, position, created_at, updated_at",
  },
  {
    table: "comments",
    columns: "id, task_id, author, body, created_at, updated_at",
  },
  {
    table: "whiteboards",
    columns: "board_id, scene, updated_at",
  },
  {
    table: "notes",
    columns: "board_id, document, updated_at",
  },
] as const;

async function copyTable(
  source: Client,
  target: Transaction,
  table: string,
  columns: string,
): Promise<number> {
  const rows = await source.execute(`select ${columns} from ${table}`);
  if (rows.rows.length === 0) return 0;

  const cols = columns.split(", ").map((column) => column.trim());
  const placeholders = cols.map(() => "?").join(", ");

  for (const row of rows.rows) {
    const values = cols.map((column) =>
      column === "owner_id" ? LOCAL_USER_ID : (row[column] ?? null),
    );
    await target.execute({
      sql: `insert or ignore into ${table} (${cols.join(", ")}) values (${placeholders})`,
      args: values,
    });
  }
  return rows.rows.length;
}

/**
 * Copy the local workspace (read from `localDatabaseUrl`) into the database
 * currently served by the local API, which is always the premium sync mirror
 * while this route is available. Every board is re-owned to the mirror's
 * implicit account row; child rows keep their ids so the operation is
 * idempotent. The SQLite sync triggers queue the imported rows as changes, so
 * the next sync push uploads them to the premium account.
 *
 * This is the only sanctioned path for local data to enter a cloud workspace,
 * and it always requires an explicit user action; background sync never reads
 * the local database.
 */
export async function importLocalWorkspace(
  localDatabaseUrl: string,
): Promise<ImportLocalResult> {
  const target = getClient();
  let source: Client;
  try {
    source = createClient({ url: localDatabaseUrl });
  } catch {
    throw new ApiError(
      "Could not open the local workspace. Open the local workspace once, then import again.",
      409,
    );
  }
  let boards = 0;
  let tasks = 0;

  try {
    const tx = await target.transaction("write");
    try {
      for (const { table, columns } of TABLES) {
        const copied = await copyTable(source, tx, table, columns);
        if (table === "boards") boards = copied;
        if (table === "tasks") tasks = copied;
      }
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      tx.close();
    }
    return { boards, tasks };
  } catch {
    throw new ApiError(
      "Could not read the local workspace. Open the local workspace once, then import again.",
      409,
    );
  } finally {
    source.close();
  }
}
