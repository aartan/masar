import { eq, isNull, or } from "drizzle-orm";

import { getDb } from "@/db";
import { boards, users } from "@/db/schema";
import { LEGACY_WORKSPACE_ID } from "@/lib/server/legacy-workspace";

/**
 * The desktop app has one implicit local account. It owns all local boards and
 * never requires sign-in. Premium account identities are separate and live in
 * the remote API; they never grant or restrict local workspace access.
 */
export const LOCAL_USER_ID = "local-user";

const LOCAL_USER = {
  id: LOCAL_USER_ID,
  name: "Local workspace",
  email: "local@masar.app",
  emailVerified: true,
} as const;

let ensured = false;

/** Ensure the single local account row exists and return it. Idempotent. */
export async function getLocalUser() {
  const db = getDb();
  if (!ensured) {
    await db.insert(users).values(LOCAL_USER).onConflictDoNothing();
    // Older single-user installs may have unowned boards, or boards parked
    // behind the legacy migration account. In a local-only desktop app they all
    // belong to the one local workspace. This never touches another user's
    // boards because this database is not shared.
    await db
      .update(boards)
      .set({ ownerId: LOCAL_USER_ID })
      .where(
        or(isNull(boards.ownerId), eq(boards.ownerId, LEGACY_WORKSPACE_ID)),
      );
    ensured = true;
  }
  const [row] = await db.select().from(users).where(eq(users.id, LOCAL_USER_ID));
  if (!row) {
    throw new Error("Failed to initialize the local desktop account.");
  }
  return row;
}
