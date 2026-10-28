import "./load-env";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { resolve } from "node:path";

import { resolveDatabaseConfig } from "../src/db/config";
import * as schema from "../src/db/schema";

async function main() {
  const config = resolveDatabaseConfig();
  const maskedUrl = config.isRemote
    ? config.url.replace(/\/\/([^@/]+@)?/, "//")
    : config.url;
  console.log(`[masar] Running migrations against ${maskedUrl}`);

  const client = createClient({
    url: config.url,
    authToken: config.authToken,
  });
  const db = drizzle(client, { schema });

  try {
    await migrate(db, {
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    });
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
