import { utilityProcess } from "electron";
import path from "node:path";

import { databaseUrl, migrateEntry, migrationsDir, runtimeDir, serverEntry } from "../paths";

type Logger = (line: string) => void;

export interface ServerHandle {
  /** Resolves with the exit code when the process exits (including via kill). */
  exited: Promise<number>;
  kill(): void;
}

/**
 * Run the bundled local API in an Electron utility process. The runtime
 * directory contains the bundled server and the native libSQL package needed
 * by the SQLite database.
 */
export function startServer(
  env: Record<string, string>,
  log: Logger,
): ServerHandle {
  const dir = runtimeDir();
  const child = utilityProcess.fork(serverEntry(), [], {
    cwd: dir,
    stdio: "pipe",
    serviceName: "masar-local-api",
    env: { ...process.env, ...env },
  });

  child.stdout?.on("data", (chunk) => log(`[local] ${chunk.toString().trimEnd()}`));
  child.stderr?.on("data", (chunk) => log(`[local:err] ${chunk.toString().trimEnd()}`));

  return {
    exited: new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 0))),
    kill: () => child.kill(),
  };
}

/** Apply Drizzle migrations to the given database before the local API starts. */
export function runMigrations(
  log: Logger,
  targetDatabaseUrl = databaseUrl(),
): Promise<{ code: number; stderr: string }> {
  const dir = runtimeDir();

  return new Promise((resolve) => {
    const child = utilityProcess.fork(migrateEntry(), [], {
      cwd: dir,
      stdio: "pipe",
      serviceName: "masar-migrate",
      env: {
        ...process.env,
        DATABASE_URL: targetDatabaseUrl,
        MASAR_MIGRATIONS_DIR: migrationsDir(),
        NODE_PATH: path.join(dir, "node_modules"),
      },
    });

    let stderr = "";
    child.stdout?.on("data", (chunk) => log(`[migrate] ${chunk.toString().trimEnd()}`));
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      log(`[migrate:err] ${text.trimEnd()}`);
    });

    child.on("exit", (code) => resolve({ code: code ?? 0, stderr }));
  });
}
