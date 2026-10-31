export interface DatabaseConfig {
  url: string;
  authToken?: string;
}

/**
 * The desktop is local-first. SQLite is always the primary datastore; the
 * premium API owns its own PostgreSQL database and is never used as the local
 * application database.
 */
export function resolveDatabaseConfig(
  env: Record<string, string | undefined> = process.env,
): DatabaseConfig {
  const url = env.DATABASE_URL?.trim() || "file:./data/app.db";
  const authToken =
    env.DATABASE_AUTH_TOKEN?.trim() || undefined;
  return { url, authToken };
}
