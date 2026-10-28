import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import * as schema from "@/db/schema";
import type { AppDatabase } from "@/db";

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

/**
 * Inserts an account directly. Server modules only need a stable owner id;
 * Better Auth's own sign-up flow is covered by the Playwright tests.
 */
export async function createTestUser(
  database: AppDatabase,
  overrides: Partial<typeof schema.users.$inferInsert> = {},
): Promise<{ id: string; name: string; email: string }> {
  const id = overrides.id ?? randomUUID();
  const name = overrides.name ?? "Test user";
  const email = overrides.email ?? `user-${id}@example.test`;

  await database.insert(schema.users).values({
    id,
    name,
    email,
    emailVerified: false,
    ...overrides,
  });

  return { id, name, email };
}
