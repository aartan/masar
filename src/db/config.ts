export interface DatabaseConfig {
  url: string;
  authToken?: string;
  isRemote: boolean;
}

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

export function isRemoteDatabaseUrl(url: string): boolean {
  return /^(libsql|https?|wss?):/i.test(url);
}

/**
 * Resolves database configuration for every runtime (local, tests, Vercel).
 *
 * Local development defaults to a persistent SQLite file at ./data/app.db.
 * Vercel must be configured with a hosted Turso/libSQL database. We fail
 * loudly rather than silently writing to an ephemeral serverless filesystem.
 */
export function resolveDatabaseConfig(
  env: Record<string, string | undefined> = process.env,
): DatabaseConfig {
  const configuredUrl =
    env.DATABASE_URL?.trim() || env.TURSO_DATABASE_URL?.trim() || undefined;
  const authToken =
    env.TURSO_AUTH_TOKEN?.trim() ||
    env.DATABASE_AUTH_TOKEN?.trim() ||
    undefined;
  const onVercel = env.VERCEL === "1" || Boolean(env.VERCEL_ENV);

  if (onVercel && !configuredUrl) {
    throw new DatabaseConfigurationError(
      "Missing production database configuration. Set DATABASE_URL to a hosted Turso/libSQL URL (and TURSO_AUTH_TOKEN) in your Vercel project environment variables. A local SQLite file cannot be used on Vercel because the deployed filesystem is ephemeral. See README.md → Deployment.",
    );
  }

  if (onVercel && configuredUrl?.startsWith("file:")) {
    throw new DatabaseConfigurationError(
      "DATABASE_URL points to a local file on Vercel. Serverless filesystems are not persistent. Use a hosted Turso/libSQL database (libsql://…) instead. See README.md → Deployment.",
    );
  }

  const url = configuredUrl ?? "file:./data/app.db";
  const isRemote = isRemoteDatabaseUrl(url);

  if (onVercel && isRemote && !authToken) {
    throw new DatabaseConfigurationError(
      "Missing TURSO_AUTH_TOKEN for the hosted database. Add the token from `turso db tokens create` to your Vercel environment variables.",
    );
  }

  if (
    env.NODE_ENV === "production" &&
    !onVercel &&
    !configuredUrl &&
    env.ALLOW_LOCAL_DB_IN_PRODUCTION !== "true"
  ) {
    // A warning (not a failure) keeps `next build` and self-hosted previews
    // working. Production hosts must opt in explicitly or configure a URL.
    console.warn(
      "[kanso] Using the default local SQLite file in a production runtime. Set DATABASE_URL or ALLOW_LOCAL_DB_IN_PRODUCTION=true.",
    );
  }

  return { url, authToken, isRemote };
}
