import { count, eq, isNull, or } from "drizzle-orm";

import type { AppDatabase } from "@/db";
import { boards, users } from "@/db/schema";

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
    await tx
      .update(boards)
      .set({ ownerId: owner.id })
      .where(
        or(eq(boards.ownerId, LEGACY_WORKSPACE_ID), isNull(boards.ownerId)),
      );
    await tx.delete(users).where(eq(users.id, LEGACY_WORKSPACE_ID));
  });

  return { ownerEmail: owner.email, boardCount, dryRun: false };
}
