import "./load-env";

import { execFileSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { resolveDatabaseConfig } from "../src/db/config";

function main() {
  const config = resolveDatabaseConfig();
  if (!config.url.startsWith("file:")) {
    console.error("[masar] Refusing to reset a non-file database.");
    process.exit(1);
  }

  const filePath = config.url.slice("file:".length);
  const absolutePath = isAbsolute(filePath)
    ? filePath
    : resolve(process.cwd(), filePath);

  for (const suffix of ["", "-wal", "-shm"]) {
    const target = `${absolutePath}${suffix}`;
    if (existsSync(target)) {
      unlinkSync(target);
      console.log(`[masar] Removed ${target}`);
    }
  }

  execFileSync("npx", ["tsx", "scripts/migrate.ts"], {
    stdio: "inherit",
    env: process.env,
  });
  console.log("[masar] Database reset. Run `npm run db:seed` for demo data.");
}

main();
