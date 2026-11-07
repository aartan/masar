import { and, eq, isNull, or } from "drizzle-orm";

import { getDb } from "@/db";
import { boards, projects, users } from "@/db/schema";
import { DEFAULT_PROJECT_NAME } from "@/lib/constants";
import { LEGACY_WORKSPACE_ID } from "@/lib/server/legacy-workspace";
import { ensureDefaultProject } from "@/lib/server/projects";

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
      .update(projects)
      .set({ ownerId: LOCAL_USER_ID })
      .where(
        or(isNull(projects.ownerId), eq(projects.ownerId, LEGACY_WORKSPACE_ID)),
      );
    await db
      .update(boards)
      .set({ ownerId: LOCAL_USER_ID })
      .where(
        or(isNull(boards.ownerId), eq(boards.ownerId, LEGACY_WORKSPACE_ID)),
      );

    // Databases created before projects (or by the rollout-era app) can still
    // contain boards without a project. Keep every board visible by putting it
    // into the default project, creating that project if necessary.
    const [unscoped] = await db
      .select({ id: boards.id })
      .from(boards)
      .where(and(eq(boards.ownerId, LOCAL_USER_ID), isNull(boards.projectId)))
      .limit(1);
    if (unscoped) {
      const projectId = await ensureDefaultProject(
        LOCAL_USER_ID,
        DEFAULT_PROJECT_NAME,
        db,
      );
      await db
        .update(boards)
        .set({ projectId })
        .where(
          and(eq(boards.ownerId, LOCAL_USER_ID), isNull(boards.projectId)),
        );
    }
    ensured = true;
  }
  const [row] = await db.select().from(users).where(eq(users.id, LOCAL_USER_ID));
  if (!row) {
    throw new Error("Failed to initialize the local desktop account.");
  }
  return row;
}
