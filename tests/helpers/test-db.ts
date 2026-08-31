import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import * as schema from "@/db/schema";

/**
 * Creates a throwaway SQLite/libSQL database with every migration applied.
 * Tests receive the Drizzle instance explicitly so they never touch the
 * developer's ./data/app.db.
 */
export async function createTestDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "masar-test-"));
  const client = createClient({ url: `file:${join(directory, "test.db")}` });
  const db = drizzle(client, { schema });

  await migrate(db, {
    migrationsFolder: join(process.cwd(), "drizzle"),
  });

  return {
    db,
    client,
    async close() {
      client.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
