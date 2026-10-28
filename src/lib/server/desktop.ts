import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { users } from "@/db/schema";

/**
 * The desktop app runs in one of two modes:
 *
 * - Local (free, default): a single-user offline workspace backed by a local
 *   SQLite file. There is no sign-up or sign-in; one implicit local account
 *   owns everything. Signalled by `MASAR_LOCAL_MODE=1`.
 * - Sync (premium): the local server talks to the hosted Turso database with
 *   real Better Auth accounts, so data syncs across devices. In this mode the
 *   flag is absent and the app behaves like the hosted web app.
 */
export function isLocalMode(): boolean {
  return process.env.MASAR_LOCAL_MODE === "1";
}

/** Fixed id of the implicit local account that owns all local-mode data. */
export const LOCAL_USER_ID = "local-user";

const LOCAL_USER = {
  id: LOCAL_USER_ID,
  name: "Local workspace",
  email: "local@masar.app",
  emailVerified: true,
} as const;

let ensured = false;

/**
 * Ensure the single local account row exists (boards reference it via
 * `owner_id`) and return it. Idempotent; the upsert runs once per process.
 */
export async function getLocalUser() {
  const db = getDb();
  if (!ensured) {
    await db.insert(users).values(LOCAL_USER).onConflictDoNothing();
    ensured = true;
  }
  const [row] = await db.select().from(users).where(eq(users.id, LOCAL_USER_ID));
  if (!row) {
    throw new Error("Failed to initialize the local desktop account.");
  }
  return row;
}
