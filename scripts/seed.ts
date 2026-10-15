import "./load-env";

import { randomUUID } from "node:crypto";

import { createClient } from "@libsql/client";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import { resolveDatabaseConfig } from "../src/db/config";
import {
  boards,
  columns,
  comments,
  labels,
  subtasks,
  taskLabels,
  tasks,
  users,
} from "../src/db/schema";
import type { BoardColor, LabelColor, Priority } from "../src/lib/constants";

interface SeedSubtask {
  title: string;
  done?: boolean;
}

interface SeedComment {
  author: string;
  body: string;
  daysAgo: number;
}

interface SeedTask {
  title: string;
  description?: string;
  column: string;
  priority: Priority;
  dueInDays?: number;
  labels?: string[];
  subtasks?: SeedSubtask[];
  comments?: SeedComment[];
  completedDaysAgo?: number;
}

interface SeedBoard {
  name: string;
  description: string;
  color: BoardColor;
  columns: Array<{ name: string; isDone?: boolean }>;
  labels: Array<{ name: string; color: LabelColor }>;
  tasks: SeedTask[];
}

const DEFAULT_LABELS: SeedBoard["labels"] = [
  { name: "Design", color: "violet" },
  { name: "Engineering", color: "sky" },
  { name: "Marketing", color: "amber" },
  { name: "Research", color: "sage" },
  { name: "Bug", color: "rose" },
];

const seedBoards: SeedBoard[] = [
  {
    name: "Masar launch",
    description: "Plan and ship the work that moves Masar forward.",
    color: "sage",
    columns: [
      { name: "Backlog" },
      { name: "To Do" },
      { name: "In Progress" },
      { name: "In Review" },
      { name: "Done", isDone: true },
    ],
    labels: DEFAULT_LABELS,
    tasks: [
      {
        title: "Explore offline-first mode",
        description:
          "Sketch how local-first sync could work for tasks and comments without adding conflict fatigue.",
        column: "Backlog",
        priority: "low",
        dueInDays: 21,
        labels: ["Engineering"],
      },
      {
        title: "Research calendar integrations",
        description:
          "Compare Google Calendar, Outlook, and Cron. Focus on two-way due-date sync.",
        column: "Backlog",
        priority: "medium",
        dueInDays: 14,
        labels: ["Research"],
      },
      {
        title: "Audit empty states across the app",
        description:
          "Every empty state should explain what belongs here and offer one clear next action.",
        column: "Backlog",
        priority: "low",
        labels: ["Design"],
      },
      {
        title: "Design pricing page",
        description:
          "Three tiers, annual toggle, and a clear comparison table. Keep the visual language close to the board.",
        column: "To Do",
        priority: "high",
        dueInDays: 4,
        labels: ["Design", "Marketing"],
        subtasks: [
          { title: "Collect copy from Noah", done: true },
          { title: "Explore comparison table layouts" },
          { title: "Mobile pass" },
        ],
        comments: [
          {
            author: "Noah Williams",
            body: "Copy doc is in the shared drive. I tightened the plan names to Studio and Scale.",
            daysAgo: 1,
          },
        ],
      },
      {
        title: "Write onboarding checklist",
        description:
          "A first-run checklist that gets someone from empty workspace to a useful board in under two minutes.",
        column: "To Do",
        priority: "medium",
        dueInDays: 6,
        labels: ["Marketing"],
      },
      {
        title: "Set up usage analytics",
        description:
          "Track activation, board creation, and weekly active workspaces. No invasive tracking.",
        column: "To Do",
        priority: "high",
        dueInDays: 3,
        labels: ["Engineering"],
        subtasks: [
          { title: "Pick an event taxonomy" },
          { title: "Add server-side events" },
        ],
      },
      {
        title: "Build command palette",
        description:
          "One place to jump between boards, find tasks, and create new work. Keyboard-first with fuzzy results.",
        column: "In Progress",
        priority: "urgent",
        dueInDays: 1,
        labels: ["Engineering", "Design"],
        subtasks: [
          { title: "Dialog shell and focus management", done: true },
          { title: "Debounced search API", done: true },
          { title: "Keyboard navigation" },
          { title: "Polish transitions" },
        ],
        comments: [
          {
            author: "Priya Raman",
            body: "The result rows feel a little tall on mobile. Can we fit four results above the keyboard?",
            daysAgo: 2,
          },
          {
            author: "Maya Chen",
            body: "Yes — dropping the board subtitle on small screens. Will push a build tonight.",
            daysAgo: 1,
          },
        ],
      },
      {
        title: "Polish mobile board gestures",
        description:
          "Make horizontal board scrolling feel intentional and keep the drag handle reachable one-handed.",
        column: "In Progress",
        priority: "medium",
        dueInDays: 5,
        labels: ["Design"],
        subtasks: [
          { title: "Test on 390px viewport", done: true },
          { title: "Tune column snap points" },
        ],
      },
      {
        title: "Refine task detail sheet",
        description:
          "Bring priority, due date, and labels above the fold. Comments should feel like a conversation, not a log.",
        column: "In Review",
        priority: "high",
        dueInDays: 2,
        labels: ["Design"],
        subtasks: [
          { title: "Reduce vertical rhythm", done: true },
          { title: "Add inline label creation", done: true },
          { title: "Check keyboard focus order" },
        ],
        comments: [
          {
            author: "Noah Williams",
            body: "Love the tighter metadata. The due-date chip is much easier to scan now.",
            daysAgo: 1,
          },
        ],
      },
      {
        title: "Accessibility pass on board",
        description:
          "Full keyboard drag-and-drop, visible focus rings, and screen-reader announcements for moves.",
        column: "In Review",
        priority: "high",
        dueInDays: -1,
        labels: ["Bug", "Engineering"],
        subtasks: [
          { title: "Audit focus order", done: true },
          { title: "Keyboard sensor for tasks", done: true },
          { title: "Test with VoiceOver" },
        ],
        comments: [
          {
            author: "Maya Chen",
            body: "This is the last launch blocker. Let's verify the announcement copy before Friday.",
            daysAgo: 1,
          },
        ],
      },
      {
        title: "Define design tokens",
        description:
          "Warm paper, forest ink, and one accent. Tokens live in CSS variables and map to both themes.",
        column: "Done",
        priority: "none",
        dueInDays: -3,
        labels: ["Design"],
        completedDaysAgo: 3,
      },
      {
        title: "Create database schema",
        description:
          "Normalized boards, columns, tasks, labels, subtasks, and comments with cascading foreign keys.",
        column: "Done",
        priority: "high",
        dueInDays: -4,
        labels: ["Engineering"],
        completedDaysAgo: 4,
      },
      {
        title: "Ship marketing site",
        description:
          "A fast landing page with a live product tour and clear pricing.",
        column: "Done",
        priority: "medium",
        dueInDays: -1,
        labels: ["Marketing"],
        completedDaysAgo: 1,
      },
    ],
  },
  {
    name: "Website refresh",
    description: "A faster, clearer home for the Masar story.",
    color: "sky",
    columns: [
      { name: "Backlog" },
      { name: "To Do" },
      { name: "In Progress" },
      { name: "Done", isDone: true },
    ],
    labels: DEFAULT_LABELS,
    tasks: [
      {
        title: "Rewrite homepage copy",
        description:
          "Lead with the product, not a feature list. Three short sections, one CTA.",
        column: "To Do",
        priority: "high",
        dueInDays: 3,
        labels: ["Marketing"],
      },
      {
        title: "New pricing illustrations",
        description:
          "Three abstract board vignettes in the same warm palette. Light and dark variants.",
        column: "To Do",
        priority: "medium",
        dueInDays: 7,
        labels: ["Design", "Marketing"],
      },
      {
        title: "Lighthouse performance pass",
        description:
          "Target 98+ on mobile. Audit fonts, image loading, and third-party scripts.",
        column: "In Progress",
        priority: "urgent",
        dueInDays: -1,
        labels: ["Engineering", "Bug"],
        subtasks: [
          { title: "Baseline audit", done: true },
          { title: "Subset the font files" },
          { title: "Remove unused client JS" },
        ],
      },
      {
        title: "Set up CMS previews",
        description:
          "Every content change gets a preview URL in the pull request.",
        column: "To Do",
        priority: "medium",
        dueInDays: 5,
        labels: ["Engineering"],
      },
      {
        title: "Archive old case studies",
        description: "Move the three pre-2024 stories into the archive collection.",
        column: "Done",
        priority: "low",
        dueInDays: -2,
        labels: ["Marketing"],
        completedDaysAgo: 2,
      },
    ],
  },
];

function isoDateFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function main() {
  const force = process.argv.includes("--force");
  const emailArg = process.argv.findIndex((value) => value === "--email");
  const email =
    emailArg >= 0 ? process.argv[emailArg + 1]?.trim().toLowerCase() : undefined;

  if (!email) {
    console.error(
      "[masar] Seed needs an owner. Register an account first, then run:\n" +
        "  npm run db:seed -- --email you@example.com\n" +
        "Add `--force` to replace that account's existing boards.",
    );
    process.exit(1);
  }

  const config = resolveDatabaseConfig();
  const client = createClient({ url: config.url, authToken: config.authToken });
  const database = drizzle(client, {
    schema: {
      users,
      boards,
      columns,
      labels,
      tasks,
      taskLabels,
      subtasks,
      comments,
    },
  });

  try {
    const [owner] = await database
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!owner) {
      console.error(
        `[masar] No account found for ${email}. Create the account in Masar first, then run the seed again.`,
      );
      process.exit(1);
    }

    const [existing] = await database
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(boards)
      .where(eq(boards.ownerId, owner.id));

    if ((existing?.value ?? 0) > 0 && !force) {
      console.log(
        `[masar] Seed skipped: ${existing?.value} board(s) already exist for ${owner.email}. Use \`npm run db:seed -- --email ${owner.email} --force\` to replace them.`,
      );
      return;
    }

    const now = new Date();
    const boardRows: Array<typeof boards.$inferInsert> = [];
    const columnRows: Array<typeof columns.$inferInsert> = [];
    const labelRows: Array<typeof labels.$inferInsert> = [];
    const taskRows: Array<typeof tasks.$inferInsert> = [];
    const taskLabelRows: Array<typeof taskLabels.$inferInsert> = [];
    const subtaskRows: Array<typeof subtasks.$inferInsert> = [];
    const commentRows: Array<typeof comments.$inferInsert> = [];

    seedBoards.forEach((board, boardIndex) => {
      const boardId = randomUUID();
      const createdAt = daysAgo(14 - boardIndex * 3);
      boardRows.push({
        id: boardId,
        ownerId: owner.id,
        name: board.name,
        description: board.description,
        color: board.color,
        position: boardIndex,
        createdAt,
        updatedAt: now,
      });

      const columnIds = new Map<string, string>();
      board.columns.forEach((column, index) => {
        const columnId = randomUUID();
        columnIds.set(column.name, columnId);
        columnRows.push({
          id: columnId,
          boardId,
          name: column.name,
          position: index,
          isDone: column.isDone ?? false,
          createdAt,
          updatedAt: now,
        });
      });

      const labelIds = new Map<string, string>();
      board.labels.forEach((label, index) => {
        const labelId = randomUUID();
        labelIds.set(label.name, labelId);
        labelRows.push({
          id: labelId,
          boardId,
          name: label.name,
          color: label.color,
          createdAt: new Date(createdAt.getTime() + index * 1000),
        });
      });

      const tasksByColumn = new Map<string, number>();
      board.tasks.forEach((task, index) => {
        const columnId = columnIds.get(task.column);
        if (!columnId) throw new Error(`Unknown column: ${task.column}`);
        const position = tasksByColumn.get(task.column) ?? 0;
        tasksByColumn.set(task.column, position + 1);

        const taskId = randomUUID();
        const taskCreatedAt = hoursAgo((board.tasks.length - index) * 5 + 2);
        const column = board.columns.find((item) => item.name === task.column);
        const done = column?.isDone ?? false;
        const completedAt =
          done && task.completedDaysAgo !== undefined
            ? daysAgo(task.completedDaysAgo)
            : done
              ? daysAgo(1)
              : null;

        taskRows.push({
          id: taskId,
          boardId,
          columnId,
          title: task.title,
          description: task.description ?? null,
          priority: task.priority,
          dueDate:
            task.dueInDays === undefined
              ? null
              : isoDateFromNow(task.dueInDays),
          position,
          completedAt,
          createdAt: taskCreatedAt,
          updatedAt: task.completedDaysAgo
            ? daysAgo(task.completedDaysAgo)
            : hoursAgo(index + 1),
        });

        for (const labelName of task.labels ?? []) {
          const labelId = labelIds.get(labelName);
          if (labelId) taskLabelRows.push({ taskId, labelId });
        }

        (task.subtasks ?? []).forEach((subtask, subtaskIndex) => {
          subtaskRows.push({
            id: randomUUID(),
            taskId,
            title: subtask.title,
            completed: subtask.done ?? false,
            position: subtaskIndex,
            createdAt: taskCreatedAt,
          });
        });

        (task.comments ?? []).forEach((comment) => {
          commentRows.push({
            id: randomUUID(),
            taskId,
            author: comment.author,
            body: comment.body,
            createdAt: daysAgo(comment.daysAgo),
          });
        });
      });
    });

    await database.transaction(async (tx) => {
      if (force) {
        await tx.delete(boards).where(eq(boards.ownerId, owner.id));
      }
      if (boardRows.length > 0) await tx.insert(boards).values(boardRows);
      if (columnRows.length > 0) await tx.insert(columns).values(columnRows);
      if (labelRows.length > 0) await tx.insert(labels).values(labelRows);
      if (taskRows.length > 0) await tx.insert(tasks).values(taskRows);
      if (taskLabelRows.length > 0)
        await tx.insert(taskLabels).values(taskLabelRows);
      if (subtaskRows.length > 0)
        await tx.insert(subtasks).values(subtaskRows);
      if (commentRows.length > 0)
        await tx.insert(comments).values(commentRows);
    });

    console.log(
      `[masar] Seeded ${boardRows.length} boards, ${taskRows.length} tasks, ${labelRows.length} labels for ${owner.email}.`,
    );
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error("[masar] Seed failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
