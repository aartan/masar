import { getTableColumns } from "drizzle-orm";
import { z } from "zod";

import { getClient } from "@/db";
import type { InValue } from "@libsql/client";
import * as schema from "@/db/schema";

/**
 * A workspace exported from a desktop local database: each table is an array of
 * raw rows keyed by database column name. Validated loosely here; column names
 * are whitelisted against the live schema before any SQL is built.
 */
const rowSchema = z.record(z.string(), z.unknown());
export const workspacePayloadSchema = z.object({
  boards: z.array(rowSchema),
  columns: z.array(rowSchema),
  labels: z.array(rowSchema),
  tasks: z.array(rowSchema),
  taskLabels: z.array(rowSchema),
  subtasks: z.array(rowSchema),
  comments: z.array(rowSchema),
});
export type WorkspacePayload = z.infer<typeof workspacePayloadSchema>;

type Row = Record<string, unknown>;

// FK-safe insert order, mapping each payload key to its database table.
const TABLES = [
  { key: "boards", table: schema.boards, name: "boards" },
  { key: "columns", table: schema.columns, name: "columns" },
  { key: "labels", table: schema.labels, name: "labels" },
  { key: "tasks", table: schema.tasks, name: "tasks" },
  { key: "taskLabels", table: schema.taskLabels, name: "task_labels" },
  { key: "subtasks", table: schema.subtasks, name: "subtasks" },
  { key: "comments", table: schema.comments, name: "comments" },
] as const;

function allowedColumns(table: (typeof TABLES)[number]["table"]): Set<string> {
  return new Set(Object.values(getTableColumns(table)).map((col) => col.name));
}

/**
 * Import an exported local workspace into the signed-in account. Rows keep
 * their original ids (so re-importing is a no-op) and every board is re-owned
 * to `targetOwnerId`. Column names are filtered to the live schema and all
 * values are bound as parameters, so the payload cannot inject SQL.
 */
export async function importWorkspacePayload(
  targetOwnerId: string,
  payload: WorkspacePayload,
): Promise<{ boards: number; tasks: number }> {
  if (payload.boards.length === 0) {
    return { boards: 0, tasks: 0 };
  }

  const statements: { sql: string; args: InValue[] }[] = [];
  for (const { key, table, name } of TABLES) {
    const columns = allowedColumns(table);
    for (const row of payload[key] as Row[]) {
      const cols = Object.keys(row).filter((col) => columns.has(col));
      const values = cols.map((col) => (col === "owner_id" ? targetOwnerId : (row[col] ?? null)));
      if (name === "boards" && !cols.includes("owner_id")) {
        cols.push("owner_id");
        values.push(targetOwnerId);
      }
      if (cols.length === 0) continue;
      const placeholders = cols.map(() => "?").join(", ");
      statements.push({
        sql: `INSERT OR IGNORE INTO ${name} (${cols.join(", ")}) VALUES (${placeholders})`,
        args: values as InValue[],
      });
    }
  }

  await getClient().batch(statements, "write");
  return { boards: payload.boards.length, tasks: payload.tasks.length };
}
