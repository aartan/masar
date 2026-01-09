import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

import { resolveDatabaseConfig } from "./config";
import * as schema from "./schema";

export type AppDatabase = LibSQLDatabase<typeof schema>;

interface DatabaseBundle {
  db: AppDatabase;
  client: Client;
}

const globalForDatabase = globalThis as unknown as {
  __kansoDatabase?: DatabaseBundle;
};

export function createDatabase(
  url: string,
  authToken?: string,
): DatabaseBundle {
  const client = createClient({ url, authToken });
  const db = drizzle(client, { schema });
  return { db, client };
}

export function getDatabaseBundle(): DatabaseBundle {
  if (!globalForDatabase.__kansoDatabase) {
    const config = resolveDatabaseConfig();
    globalForDatabase.__kansoDatabase = createDatabase(
      config.url,
      config.authToken,
    );
  }
  return globalForDatabase.__kansoDatabase;
}

export function getDb(): AppDatabase {
  return getDatabaseBundle().db;
}

export function getClient(): Client {
  return getDatabaseBundle().client;
}

export { schema };
