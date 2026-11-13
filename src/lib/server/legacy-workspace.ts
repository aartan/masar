import { randomUUID } from "node:crypto";

import { and, count, eq, isNull, or } from "drizzle-orm";

import type { AppDatabase } from "@/db";
import { boards, folders, projects, users } from "@/db/schema";

export const LEGACY_WORKSPACE_ID = "legacy-workspace";

export interface ClaimResult {
  ownerEmail: string;
  boardCount: number;
  dryRun: boolean;
}

/**
 * Explicitly moves the pre-authentication workspace (and any boards created by
 * the old app during the rollout window) to a registered account. There is no
 * automatic assignment: the caller must name the account and confirm.
 */
export async function claimLegacyWorkspace(
  database: AppDatabase,
  email: string,
  options: { dryRun?: boolean } = {},
): Promise<ClaimResult> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error("An owner email is required.");

  const [owner] = await database
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);

  if (!owner) {
    throw new Error(
      `No account exists for ${normalized}. Register that account first, then run the claim again.`,
    );
  }
  if (owner.id === LEGACY_WORKSPACE_ID) {
    throw new Error("The legacy workspace account cannot own itself.");
  }

  const [row] = await database
    .select({ value: count() })
    .from(boards)
    .where(
      or(eq(boards.ownerId, LEGACY_WORKSPACE_ID), isNull(boards.ownerId)),
    );
  const boardCount = row?.value ?? 0;

  if (options.dryRun) {
    return { ownerEmail: owner.email, boardCount, dryRun: true };
  }

  await database.transaction(async (tx) => {
    // Reassign projects first so the boards' project_id FK still resolves after
    // the legacy user row (and its cascade) is removed. Both legacy and
    // NULL-owned rows move to the explicit account.
    await tx
      .update(projects)
      .set({ ownerId: owner.id })
      .where(
        or(eq(projects.ownerId, LEGACY_WORKSPACE_ID), isNull(projects.ownerId)),
      );
    await tx
      .update(folders)
      .set({ ownerId: owner.id })
      .where(
        or(eq(folders.ownerId, LEGACY_WORKSPACE_ID), isNull(folders.ownerId)),
      );
    await tx
      .update(boards)
      .set({ ownerId: owner.id })
      .where(
        or(eq(boards.ownerId, LEGACY_WORKSPACE_ID), isNull(boards.ownerId)),
      );

    // Rollout-era boards can have neither an owner nor a project. Give them a
    // visible home now that they belong to an explicit account.
    const projectless = await tx
      .select({ id: boards.id })
      .from(boards)
      .where(
        and(eq(boards.ownerId, owner.id), isNull(boards.projectId)),
      )
      .limit(1);
    if (projectless.length > 0) {
      const [existingProject] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(eq(projects.ownerId, owner.id), eq(projects.archived, false)),
        )
        .limit(1);
      const projectId = existingProject?.id ?? randomUUID();
      if (!existingProject) {
        await tx.insert(projects).values({
          id: projectId,
          ownerId: owner.id,
          name: "General",
          archived: false,
        });
      }
      await tx
        .update(boards)
        .set({ projectId })
        .where(
          and(eq(boards.ownerId, owner.id), isNull(boards.projectId)),
        );
    }

    await tx.delete(users).where(eq(users.id, LEGACY_WORKSPACE_ID));
  });

  return { ownerEmail: owner.email, boardCount, dryRun: false };
}
