/**
 * Standalone database migrator for the desktop app. Compiled to
 * `desktop-migrate.js` and copied into the Next standalone directory, so its
 * `@libsql/client` / `drizzle-orm` imports resolve from the server's own
 * node_modules (including the native addon). Runs as a short-lived utility
 * process; exit code 0 means migrations applied cleanly.
 *
 * Unlike scripts/migrate.ts (web/CLI), this reads the migrations folder from
 * MASAR_MIGRATIONS_DIR instead of assuming process.cwd(), because a packaged
 * app's working directory is not the repo root.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const migrationsFolder = process.env.MASAR_MIGRATIONS_DIR;

  if (!url) throw new Error("DATABASE_URL is not set");
  if (!migrationsFolder) throw new Error("MASAR_MIGRATIONS_DIR is not set");

  const client = createClient({ url });
  const db = drizzle(client);
  try {
    await migrate(db, { migrationsFolder });
    console.log("migrations applied");
  } finally {
    client.close();
  }
}

main()
  .then(() => {
    // Electron's utilityProcess keeps the child alive on its IPC channel even
    // after the event loop drains, so exit explicitly to signal completion.
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
