import "./load-env";

import { count, eq } from "drizzle-orm";

import { getDb } from "../src/db";
import { boards } from "../src/db/schema";
import { getLocalUser, LOCAL_USER_ID } from "../src/lib/server/desktop";

/**
 * Assign any pre-auth or legacy workspace boards to the single local desktop
 * account. The runtime does this automatically on first launch; this command
 * is available for diagnostics or manual recovery.
 */
async function main(): Promise<void> {
  const db = getDb();
  const user = await getLocalUser();
  const [row] = await db
    .select({ value: count() })
    .from(boards)
    .where(eq(boards.ownerId, LOCAL_USER_ID));
  console.log(
    `[masar] Local workspace "${user.name}" owns ${row?.value ?? 0} board(s).`,
  );
}

main().catch((error: unknown) => {
  console.error(
    "[masar] Could not claim the local workspace:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
