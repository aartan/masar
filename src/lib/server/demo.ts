import { count, eq } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import { boards } from "@/db/schema";
import { ApiError } from "@/lib/api";
import type { BoardSummary } from "@/lib/types";
import { createBoard, getBoardDetail } from "./boards";
import { createLabel } from "./labels";
import { createSubtask } from "./subtasks";
import { createTask } from "./tasks";

export async function hasWorkspaceBoards(
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<boolean> {
  const [row] = await database
    .select({ value: count() })
    .from(boards)
    .where(eq(boards.ownerId, ownerId));
  return (row?.value ?? 0) > 0;
}

/**
 * Explicit opt-in demo content for a brand-new workspace. Refuses to touch a
 * workspace that already has boards so it can never merge into real work.
 */
export async function addDemoWorkspace(
  ownerId: string,
  database: AppDatabase = getDb(),
): Promise<BoardSummary> {
  if (await hasWorkspaceBoards(ownerId, database)) {
    throw new ApiError(
      "Demo content can only be added to an empty workspace.",
      409,
    );
  }

  const board = await createBoard(
    {
      name: "Welcome to Masar",
      description:
        "A small sample board for exploring columns, tasks, labels, and keyboard shortcuts.",
      color: "sage",
    },
    ownerId,
    database,
  );

  const detail = await getBoardDetail(board.id, ownerId, database);
  const column = (name: string) => {
    const match = detail.columns.find((item) => item.name === name);
    if (!match) throw new ApiError("Demo columns were not created.", 500);
    return match;
  };

  const [design, engineering, research] = await Promise.all([
    createLabel(board.id, { name: "Design", color: "violet" }, ownerId, database),
    createLabel(
      board.id,
      { name: "Engineering", color: "sky" },
      ownerId,
      database,
    ),
    createLabel(
      board.id,
      { name: "Research", color: "sage" },
      ownerId,
      database,
    ),
  ]);

  const firstTask = await createTask(
    board.id,
    {
      columnId: column("Backlog").id,
      title: "Plan your first project",
      description:
        "Write down the outcome you want, then break it into a few tasks. Drag cards between columns as work moves forward.",
      priority: "medium",
      labelIds: [research.id],
    },
    ownerId,
    database,
  );

  await createTask(
    board.id,
    {
      columnId: column("To Do").id,
      title: "Try filters and sorting",
      description:
        "Use the filter bar to focus on priority, labels, due dates, or the current column. Switch between board and list views from the toolbar.",
      priority: "high",
      labelIds: [design.id, engineering.id],
    },
    ownerId,
    database,
  );

  const progressTask = await createTask(
    board.id,
    {
      columnId: column("In Progress").id,
      title: "Explore keyboard shortcuts",
      description:
        "Press ? for the shortcut guide, or Cmd/Ctrl+K to search every board and task.",
      priority: "urgent",
      labelIds: [design.id],
    },
    ownerId,
    database,
  );

  await createTask(
    board.id,
    {
      columnId: column("Done").id,
      title: "Create your private workspace",
      description:
        "Your account is ready. Every board you create belongs only to you.",
      priority: "low",
    },
    ownerId,
    database,
  );

  await Promise.all([
    createSubtask(
      firstTask.id,
      "Add a second board for another area of work",
      ownerId,
      database,
    ),
    createSubtask(
      progressTask.id,
      "Open the task details panel",
      ownerId,
      database,
    ),
    createSubtask(
      progressTask.id,
      "Move a card with the keyboard",
      ownerId,
      database,
    ),
  ]);

  return board;
}
