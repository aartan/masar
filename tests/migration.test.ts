import { randomUUID } from "node:crypto";
import {
  cpSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient, type Client } from "@libsql/client";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppDatabase } from "@/db";
import * as schema from "@/db/schema";
import {
  boards,
  columns,
  comments,
  labels,
  subtasks,
  taskLabels,
  tasks,
  users,
} from "@/db/schema";
import {
  LEGACY_WORKSPACE_ID,
  claimLegacyWorkspace,
} from "@/lib/server/legacy-workspace";
import { createTestUser } from "./helpers/test-db";

const SOURCE_MIGRATIONS = join(process.cwd(), "drizzle");

interface MigrationFixture {
  client: Client;
  db: AppDatabase;
  migrationsFolder: string;
  close: () => void;
}

let fixture: MigrationFixture;

/**
 * Builds a migration tree containing only the pre-auth migration, so the test
 * can reproduce a database that is still running the old single-user app.
 */
function writeLegacyMigrationTree(target: string): void {
  mkdirSync(join(target, "meta"), { recursive: true });
  copyFileSync(
    join(SOURCE_MIGRATIONS, "0000_petite_toxin.sql"),
    join(target, "0000_petite_toxin.sql"),
  );

  const journal = JSON.parse(
    readFileSync(join(SOURCE_MIGRATIONS, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string }> };
  journal.entries = journal.entries.filter((entry) =>
    entry.tag.startsWith("0000_"),
  );
  writeFileSync(
    join(target, "meta", "_journal.json"),
    JSON.stringify(journal, null, 2),
  );
}

async function insertLegacyRows(client: Client): Promise<void> {
  const timestamp = 1_700_000_000_000;

  await client.batch(
    [
      `INSERT INTO boards (id, name, description, color, position, created_at, updated_at) VALUES
        ('legacy-board-1', 'Legacy launch', 'Old single-user board', 'sage', 0, ${timestamp}, ${timestamp}),
        ('legacy-board-2', 'Legacy website', 'Second old board', 'sky', 1, ${timestamp}, ${timestamp})`,
      `INSERT INTO columns (id, board_id, name, position, is_done, created_at, updated_at) VALUES
        ('legacy-column-1', 'legacy-board-1', 'Backlog', 0, 0, ${timestamp}, ${timestamp}),
        ('legacy-column-2', 'legacy-board-1', 'Done', 1, 1, ${timestamp}, ${timestamp}),
        ('legacy-column-3', 'legacy-board-2', 'To Do', 0, 0, ${timestamp}, ${timestamp})`,
      `INSERT INTO tasks (id, board_id, column_id, title, description, priority, due_date, assignee, position, completed_at, created_at, updated_at) VALUES
        ('legacy-task-1', 'legacy-board-1', 'legacy-column-1', 'Keep every task', 'Legacy description', 'high', '2026-01-01', 'Ada', 0, NULL, ${timestamp}, ${timestamp}),
        ('legacy-task-2', 'legacy-board-1', 'legacy-column-2', 'Keep completed work', NULL, 'none', NULL, NULL, 0, ${timestamp}, ${timestamp}, ${timestamp}),
        ('legacy-task-3', 'legacy-board-2', 'legacy-column-3', 'Keep second board', NULL, 'low', NULL, NULL, 0, NULL, ${timestamp}, ${timestamp})`,
      `INSERT INTO labels (id, board_id, name, color, created_at) VALUES
        ('legacy-label-1', 'legacy-board-1', 'Design', 'violet', ${timestamp}),
        ('legacy-label-2', 'legacy-board-1', 'Bug', 'rose', ${timestamp})`,
      `INSERT INTO task_labels (task_id, label_id) VALUES
        ('legacy-task-1', 'legacy-label-1'),
        ('legacy-task-1', 'legacy-label-2'),
        ('legacy-task-2', 'legacy-label-1')`,
      `INSERT INTO subtasks (id, task_id, title, completed, position, created_at) VALUES
        ('legacy-subtask-1', 'legacy-task-1', 'First child', 1, 0, ${timestamp}),
        ('legacy-subtask-2', 'legacy-task-1', 'Second child', 0, 1, ${timestamp})`,
      `INSERT INTO comments (id, task_id, author, body, created_at) VALUES
        ('legacy-comment-1', 'legacy-task-2', 'Ada', 'Old comment', ${timestamp})`,
    ],
    "write",
  );
}

beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), "masar-migration-"));
  const client = createClient({ url: `file:${join(directory, "legacy.db")}` });
  const db = drizzle(client, { schema });
  const migrationsFolder = join(directory, "drizzle");

  writeLegacyMigrationTree(migrationsFolder);
  await migrate(db, { migrationsFolder });
  await insertLegacyRows(client);

  fixture = {
    client,
    db,
    migrationsFolder,
    close() {
      client.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
});

afterAll(() => {
  fixture.close();
});

async function migrateToLatest(): Promise<void> {
  // Publish the complete migration tree, exactly like a deployment would.
  cpSync(SOURCE_MIGRATIONS, fixture.migrationsFolder, {
    recursive: true,
    force: true,
  });
  await migrate(fixture.db, { migrationsFolder: fixture.migrationsFolder });

  // The previous deployment is still running during the rollout. It inserts a
  // board without owner_id and this must keep succeeding after the migration.
  await fixture.client.execute({
    sql: `INSERT INTO boards (id, name, description, color, position, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO NOTHING`,
    args: [
      "rollout-board",
      "Created during rollout",
      null,
      "amber",
      2,
      Date.now(),
      Date.now(),
    ],
  });
}

describe("0001 auth and workspace ownership migration", () => {
  it("preserves every legacy row and parks it behind the system account", async () => {
    await migrateToLatest();

    const counts = await Promise.all([
      fixture.db.select({ value: count() }).from(boards),
      fixture.db.select({ value: count() }).from(columns),
      fixture.db.select({ value: count() }).from(tasks),
      fixture.db.select({ value: count() }).from(labels),
      fixture.db.select({ value: count() }).from(taskLabels),
      fixture.db.select({ value: count() }).from(subtasks),
      fixture.db.select({ value: count() }).from(comments),
    ]);

    expect(counts.map(([row]) => row?.value)).toEqual([3, 3, 3, 2, 3, 2, 1]);

    const boardOwners = await fixture.db
      .select({ id: boards.id, ownerId: boards.ownerId })
      .from(boards);
    const owners = new Map(boardOwners.map((row) => [row.id, row.ownerId]));
    expect(owners.get("legacy-board-1")).toBe(LEGACY_WORKSPACE_ID);
    expect(owners.get("legacy-board-2")).toBe(LEGACY_WORKSPACE_ID);
    expect(owners.get("rollout-board")).toBeNull();

    const [legacyUser] = await fixture.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, LEGACY_WORKSPACE_ID));
    expect(legacyUser?.email).toBe("legacy-workspace@masar.invalid");

    const [foreignKeyProblem] = await fixture.client.execute(
      "PRAGMA foreign_key_check",
    ).then((result) => result.rows);
    expect(foreignKeyProblem).toBeUndefined();

    // Re-running migrations is a no-op.
    await migrate(fixture.db, { migrationsFolder: fixture.migrationsFolder });
    const [boardCount] = await fixture.db.select({ value: count() }).from(boards);
    expect(boardCount?.value).toBe(3);
  });

  it("claims legacy and unowned boards only for an explicit, confirmed account", async () => {
    await migrateToLatest();

    const owner = await createTestUser(fixture.db, {
      id: randomUUID(),
      name: "Workspace owner",
      email: "owner@example.com",
    });

    const dryRun = await claimLegacyWorkspace(fixture.db, "OWNER@example.com", {
      dryRun: true,
    });
    expect(dryRun).toMatchObject({
      ownerEmail: owner.email,
      boardCount: 3,
      dryRun: true,
    });

    const unclaimed = await fixture.db
      .select({ ownerId: boards.ownerId })
      .from(boards);
    expect(unclaimed.every((row) => row.ownerId !== owner.id)).toBe(true);

    const result = await claimLegacyWorkspace(fixture.db, owner.email);
    expect(result).toMatchObject({
      ownerEmail: owner.email,
      boardCount: 3,
      dryRun: false,
    });

    const claimed = await fixture.db
      .select({ ownerId: boards.ownerId })
      .from(boards);
    expect(claimed).toHaveLength(3);
    expect(claimed.every((row) => row.ownerId === owner.id)).toBe(true);

    const [legacyUser] = await fixture.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, LEGACY_WORKSPACE_ID));
    expect(legacyUser).toBeUndefined();
  });
});
