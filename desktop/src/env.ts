import { databaseUrl } from "./paths";

/**
 * Environment for the local (free) mode server: a single-user offline workspace
 * backed by a local SQLite file. `MASAR_LOCAL_MODE` makes getCurrentUser resolve
 * to the implicit local account, so there is no sign-in/sign-up. The caller adds
 * PORT and BETTER_AUTH_URL once it has chosen a free loopback port. Sync mode
 * runs no local server (the window loads the hosted app), so it has no env.
 */
export function buildLocalEnv(secret: string): Record<string, string> {
  return {
    HOSTNAME: "127.0.0.1", // loopback only, never 0.0.0.0
    NODE_ENV: "production",
    BETTER_AUTH_SECRET: secret,
    DATABASE_URL: databaseUrl(),
    ALLOW_LOCAL_DB_IN_PRODUCTION: "true",
    MASAR_LOCAL_MODE: "1",
  };
}

/** Origin the BrowserWindow loads (local mode) and the health check targets. */
export function serverOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}
