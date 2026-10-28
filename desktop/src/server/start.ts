import { utilityProcess, type UtilityProcess } from "electron";
import path from "node:path";

import { databaseUrl, migrationsDir, standaloneDir } from "../paths";

type Logger = (line: string) => void;

export interface ServerHandle {
  /** Resolves with the exit code when the process exits (including via kill). */
  exited: Promise<number>;
  kill(): void;
}

/**
 * Fork the Next.js standalone `server.js` as an Electron utility process. A
 * utility process is a real Node environment, so the native libSQL `.node`
 * loads directly with no ELECTRON_RUN_AS_NODE juggling, and it is tied to the
 * app lifecycle so we can kill it on quit.
 */
export function startServer(env: Record<string, string>, log: Logger): ServerHandle {
  const dir = standaloneDir();
  const child = utilityProcess.fork(path.join(dir, "server.js"), [], {
    cwd: dir,
    stdio: "pipe",
    serviceName: "masar-server",
    env: { ...process.env, ...env },
  });

  child.stdout?.on("data", (chunk) => log(`[server] ${chunk.toString().trimEnd()}`));
  child.stderr?.on("data", (chunk) => log(`[server:err] ${chunk.toString().trimEnd()}`));

  return {
    exited: new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 0))),
    kill: () => child.kill(),
  };
}

/**
 * Run database migrations in a short-lived utility process whose cwd is the
 * standalone directory, so `@libsql/client` and `drizzle-orm` resolve from the
 * same node_modules as the server. Resolves with the exit code and captured
 * stderr.
 */
export function runMigrations(log: Logger): Promise<{ code: number; stderr: string }> {
  const dir = standaloneDir();

  return new Promise((resolve) => {
    const child = utilityProcess.fork(path.join(dir, "desktop-migrate.js"), [], {
      cwd: dir,
      stdio: "pipe",
      serviceName: "masar-migrate",
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl(),
        MASAR_MIGRATIONS_DIR: migrationsDir(),
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


/**
 * Run the local-workspace exporter in a short-lived utility process and resolve
 * with the JSON payload it prints. Used in sync mode to upload the local
 * workspace into the signed-in account.
 */
export function exportLocalWorkspace(log: Logger): Promise<string> {
  const dir = standaloneDir();
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(dir, "desktop-export.js"), [], {
      cwd: dir,
      stdio: "pipe",
      serviceName: "masar-export",
      env: { ...process.env, DATABASE_URL: databaseUrl() },
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (chunk) => (out += chunk.toString()));
    child.stderr?.on("data", (chunk) => {
      err += chunk.toString();
      log(`[export:err] ${chunk.toString().trimEnd()}`);
    });
    child.on("exit", (code) =>
      code === 0 ? resolve(out) : reject(new Error(err.trim() || `export exited ${code}`)),
    );
  });
}
