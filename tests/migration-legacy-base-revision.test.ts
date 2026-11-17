import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/db/migrate";

const SOURCE_MIGRATIONS = join(process.cwd(), "drizzle");
const LAST_PREFIX_MIGRATION_IDX = 5;

describe("legacy base_revision migration repair", () => {
  let directory!: string;
  let client!: Client;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "masar-legacy-migration-"));
    client = createClient({ url: `file:${join(directory, "test.db")}` });
  });

  afterEach(() => {
    client?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  /**
   * Recreates the schema state left by the removed 0004_daily_shen migration:
   * migrations through 0005 plus a base_revision column on sync_changes.
   */
  async function migrateThrough0005(): Promise<void> {
    const folder = join(directory, "drizzle-prefix");
    cpSync(SOURCE_MIGRATIONS, folder, { recursive: true, force: true });

    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: Array<{ idx: number }>;
    };
    journal.entries = journal.entries.filter(
      (entry) => entry.idx <= LAST_PREFIX_MIGRATION_IDX,
    );
    writeFileSync(journalPath, JSON.stringify(journal, null, 2));

    await migrate(drizzle(client), { migrationsFolder: folder });
  }

  async function syncChangeColumns(): Promise<string[]> {
    const result = await client.execute("pragma table_info(sync_changes)");
    return result.rows.map((row) => String(row.name));
  }

  it("renames the legacy column and applies the current migration chain", async () => {
    await migrateThrough0005();

    await client.execute(
      "ALTER TABLE `sync_changes` ADD COLUMN `base_revision` integer",
    );
    await client.execute(
      `INSERT INTO sync_changes
        (entity_type, entity_id, deleted, data, updated_at, base_revision)
       VALUES ('board', 'legacy-board', 0, '{}', 1, 42)`,
    );
    // The removed migration also recreated entity triggers with an explicit
    // base_revision column. SQLite must rewrite this reference on rename.
    await client.execute(
      `CREATE TRIGGER legacy_base_revision_trigger
       AFTER INSERT ON columns
       BEGIN
         INSERT INTO sync_changes
           (entity_type, entity_id, deleted, data, updated_at, base_revision)
         VALUES ('column', NEW.id, 0, '{}', 1, 99);
       END`,
    );

    await migrateDatabase(client, SOURCE_MIGRATIONS);

    const columns = await syncChangeColumns();
    expect(columns).toContain("base_revision");
    expect(columns).toContain("base_revision_legacy");

    const legacyRow = await client.execute(
      `SELECT base_revision, base_revision_legacy
       FROM sync_changes WHERE entity_id = 'legacy-board'`,
    );
    expect(legacyRow.rows[0]).toMatchObject({
      base_revision: null,
      base_revision_legacy: 42,
    });

    const legacyTrigger = await client.execute(
      `SELECT sql FROM sqlite_master
       WHERE type = 'trigger' AND name = 'legacy_base_revision_trigger'`,
    );
    expect(String(legacyTrigger.rows[0]?.sql)).toContain("base_revision_legacy");

    // The current central trigger fills the new column from the revision table.
    await client.execute(
      `INSERT INTO sync_entity_revisions (entity_type, entity_id, revision)
       VALUES ('board', 'revision-board', 7)`,
    );
    await client.execute(
      `INSERT INTO sync_changes
        (entity_type, entity_id, deleted, data, updated_at)
       VALUES ('board', 'revision-board', 0, '{}', 1)`,
    );
    const captured = await client.execute(
      `SELECT base_revision FROM sync_changes
       WHERE entity_id = 'revision-board'`,
    );
    expect(captured.rows[0]?.base_revision).toBe(7);

    // A second run is a no-op and must not rename the current column.
    await migrateDatabase(client, SOURCE_MIGRATIONS);
    expect(await syncChangeColumns()).toContain("base_revision");
  });

  it("does not rename base_revision on an already-migrated database", async () => {
    await migrateDatabase(client, SOURCE_MIGRATIONS);
    await migrateDatabase(client, SOURCE_MIGRATIONS);

    const columns = await syncChangeColumns();
    expect(columns).toContain("base_revision");
    expect(columns).not.toContain("base_revision_legacy");
  });
});
