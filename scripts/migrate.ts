import "./load-env";

import { createClient } from "@libsql/client";
import { resolve } from "node:path";

import { resolveDatabaseConfig } from "../src/db/config";
import { migrateDatabase } from "../src/db/migrate";

async function main() {
  const config = resolveDatabaseConfig();
  console.log(`[masar] Running migrations against ${config.url}`);

  const client = createClient({
    url: config.url,
    authToken: config.authToken,
  });

  try {
    await migrateDatabase(client, resolve(process.cwd(), "drizzle"));
    console.log("[masar] Migrations complete.");
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error("[masar] Migration failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
