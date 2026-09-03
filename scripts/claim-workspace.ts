import "./load-env";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { resolveDatabaseConfig } from "../src/db/config";
import * as schema from "../src/db/schema";
import { claimLegacyWorkspace } from "../src/lib/server/legacy-workspace";

function usage(): never {
  console.error(
    `[masar] Attach the pre-authentication workspace to a registered account.\n\n` +
      `Usage:\n` +
      `  npm run db:claim-workspace -- --email owner@example.com --dry-run\n` +
      `  npm run db:claim-workspace -- --email owner@example.com --confirm\n\n` +
      `The account must already exist. Nothing is assigned automatically, and\n` +
      `the command refuses to run without --confirm (or --dry-run).`,
  );
  process.exit(1);
}

async function main() {
  const emailIndex = process.argv.findIndex((value) => value === "--email");
  const email =
    emailIndex >= 0 ? process.argv[emailIndex + 1]?.trim() : undefined;
  const dryRun = process.argv.includes("--dry-run");
  const confirmed = process.argv.includes("--confirm");

  if (!email || (!dryRun && !confirmed)) usage();

  const config = resolveDatabaseConfig();
  const client = createClient({ url: config.url, authToken: config.authToken });
  const database = drizzle(client, { schema });

  try {
    const result = await claimLegacyWorkspace(database, email, { dryRun });
    if (result.dryRun) {
      console.log(
        `[masar] Dry run: ${result.boardCount} board(s) would be assigned to ${result.ownerEmail}.`,
      );
      return;
    }
    console.log(
      `[masar] Assigned ${result.boardCount} board(s) to ${result.ownerEmail}. Existing boards, tasks, labels, subtasks, and comments were not modified.`,
    );
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error("[masar] Workspace claim failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
