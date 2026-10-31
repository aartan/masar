/**
 * Development launcher:
 *   1. compile the Electron main/preload bundles
 *   2. apply SQLite migrations
 *   3. start the local API with tsx on 4782
 *   4. start Vite on 5173 (proxying /api to the local API)
 *   5. open Electron against Vite
 */
import { spawn } from "node:child_process";
import path from "node:path";

const API_PORT = Number(process.env.MASAR_DEV_API_PORT ?? 4782);
const WEB_PORT = Number(process.env.MASAR_DEV_PORT ?? 5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const repoRoot = path.resolve(__dirname, "..", "..");

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
) {
  return spawn(command, args, {
    cwd: repoRoot,
    env,
    stdio: "inherit",
    shell: false,
  });
}

async function runOnce(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = run(command, args);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

async function waitFor(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      /* not ready */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`${url} did not become ready within ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  await runOnce("npm", ["run", "desktop:compile"]);
  await runOnce("npm", ["run", "db:migrate"]);

  const localApi = run("npx", ["tsx", "src/server/entry.ts"], {
    ...process.env,
    NODE_ENV: "development",
    HOSTNAME: "127.0.0.1",
    PORT: String(API_PORT),
    DATABASE_URL: process.env.DATABASE_URL ?? "file:./data/app.db",
  });

  const vite = run("npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], {
    ...process.env,
    MASAR_DEV_API_URL: API_URL,
  });

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electronBin = require("electron") as unknown as string;

  try {
    await Promise.all([waitFor(`${API_URL}/api/health`), waitFor(WEB_URL)]);
    const electron = run(electronBin, ["."], {
      ...process.env,
      NODE_ENV: "development",
      MASAR_DEV_SERVER_URL: WEB_URL,
      MASAR_DEV_API_URL: API_URL,
    });
    electron.on("exit", () => {
      localApi.kill();
      vite.kill();
      process.exit(0);
    });
  } catch (error) {
    localApi.kill();
    vite.kill();
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
