/**
 * Reads the local-mode workspace from the local SQLite database and prints it
 * as a JSON payload on stdout, for uploading into a signed-in account in sync
 * mode. Compiled to `desktop-export.js` and run from the standalone directory
 * so `@libsql/client` resolves. DATABASE_URL points at the local file.
 */
import { createClient, type ResultSet } from "@libsql/client";

const LOCAL_USER_ID = "local-user";

function toObjects(result: ResultSet): Record<string, unknown>[] {
  return result.rows.map((row) =>
    Object.fromEntries(result.columns.map((col, i) => [col, row[i]])),
  );
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = createClient({ url });

  const empty = { boards: [], columns: [], labels: [], tasks: [], taskLabels: [], subtasks: [], comments: [] };
  try {
    const boards = toObjects(
      await client.execute({ sql: "select * from boards where owner_id = ?", args: [LOCAL_USER_ID] }),
    );
    if (boards.length === 0) {
      process.stdout.write(JSON.stringify(empty));
      return;
    }
    const boardIds = boards.map((b) => b.id as string);
    const inBoards = boardIds.map(() => "?").join(",");
    const columns = toObjects(
      await client.execute({ sql: `select * from columns where board_id in (${inBoards})`, args: boardIds }),
    );
    const labels = toObjects(
      await client.execute({ sql: `select * from labels where board_id in (${inBoards})`, args: boardIds }),
    );
    const tasks = toObjects(
      await client.execute({ sql: `select * from tasks where board_id in (${inBoards})`, args: boardIds }),
    );
    const taskIds = tasks.map((t) => t.id as string);
    let taskLabels: Record<string, unknown>[] = [];
    let subtasks: Record<string, unknown>[] = [];
    let comments: Record<string, unknown>[] = [];
    if (taskIds.length) {
      const inTasks = taskIds.map(() => "?").join(",");
      taskLabels = toObjects(
        await client.execute({ sql: `select * from task_labels where task_id in (${inTasks})`, args: taskIds }),
      );
      subtasks = toObjects(
        await client.execute({ sql: `select * from subtasks where task_id in (${inTasks})`, args: taskIds }),
      );
      comments = toObjects(
        await client.execute({ sql: `select * from comments where task_id in (${inTasks})`, args: taskIds }),
      );
    }
    process.stdout.write(JSON.stringify({ boards, columns, labels, tasks, taskLabels, subtasks, comments }));
  } catch {
    // No local workspace (e.g. unmigrated/empty file): nothing to export.
    process.stdout.write(JSON.stringify(empty));
  } finally {
    client.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
