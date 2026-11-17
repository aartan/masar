import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const LEGACY_BASE_REVISION_MIGRATION = "0014_sync_change_base_revision";
const BASE_REVISION_COLUMN = "base_revision";
const LEGACY_BASE_REVISION_COLUMN = "base_revision_legacy";

interface Journal {
  entries?: Array<{ tag?: string; when?: number }>;
}

function migrationTimestamp(
  migrationsFolder: string,
  tag: string,
): number | null {
  try {
    const journal = JSON.parse(
      readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as Journal;
    const entry = journal.entries?.find((candidate) => candidate.tag === tag);
    return typeof entry?.when === "number" ? entry.when : null;
  } catch {
    return null;
  }
}

async function lastAppliedMigration(client: Client): Promise<number> {
  try {
    const result = await client.execute(
      "select created_at from __drizzle_migrations order by created_at desc limit 1",
    );
    return Number(result.rows[0]?.created_at ?? 0);
  } catch {
    return 0;
  }
}

async function syncChangesColumns(client: Client): Promise<Set<string>> {
  try {
    const result = await client.execute("pragma table_info(sync_changes)");
    return new Set(result.rows.map((row) => String(row.name)));
  } catch {
    return new Set();
  }
}

/**
 * Some early desktop databases applied the original `0004_daily_shen`
 * migration, which added `sync_changes.base_revision`. That migration was
 * later replaced by `0004_third_zodiak`, and current `0014` adds
 * `base_revision` again. SQLite has no `ADD COLUMN IF NOT EXISTS`, so rename
 * the legacy column before Drizzle runs.
 *
 * SQLite rewrites trigger references on `RENAME COLUMN`, so the old triggers
 * keep working and write to the legacy column. The new
 * `sync_changes_capture_base` trigger fills the current column from
 * `sync_entity_revisions`, which is what the sync engine reads.
 */
async function adoptLegacyBaseRevision(
  client: Client,
  migrationsFolder: string,
): Promise<void> {
  const migrationAt = migrationTimestamp(
    migrationsFolder,
    LEGACY_BASE_REVISION_MIGRATION,
  );
  if (migrationAt === null) return;
  if ((await lastAppliedMigration(client)) >= migrationAt) return;

  const columns = await syncChangesColumns(client);
  if (!columns.has(BASE_REVISION_COLUMN)) return;
  if (columns.has(LEGACY_BASE_REVISION_COLUMN)) return;

  // A partially applied 0014 may have left the central trigger behind. Drop it
  // so 0014 recreates it against the current column name.
  await client.execute("drop trigger if exists `sync_changes_capture_base`");
  await client.execute(
    "ALTER TABLE `sync_changes` RENAME COLUMN `base_revision` TO `base_revision_legacy`",
  );
}

/** Apply pending local SQLite migrations, repairing legacy pre-rewrite DBs. */
export async function migrateDatabase(
  client: Client,
  migrationsFolder: string,
): Promise<void> {
  await adoptLegacyBaseRevision(client, migrationsFolder);
  await migrate(drizzle(client), { migrationsFolder });
}
