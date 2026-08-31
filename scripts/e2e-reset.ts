import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const url = "file:./data/e2e.db";
const absolutePath = resolve(process.cwd(), "data/e2e.db");

for (const suffix of ["", "-wal", "-shm"]) {
  const target = `${absolutePath}${suffix}`;
  if (existsSync(target)) rmSync(target);
}

console.log("[masar] Preparing a clean E2E database.");
execFileSync("npx", ["--no-install", "tsx", "scripts/migrate.ts"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
