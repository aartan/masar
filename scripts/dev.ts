/**
 * Browser development launcher: applies migrations, starts the local SQLite
 * API and Vite. Use `npm run desktop:dev` for the Electron shell.
 */
import { spawn } from "node:child_process";
import path from "node:path";

const API_PORT = Number(process.env.MASAR_DEV_API_PORT ?? 4782);
const WEB_PORT = Number(process.env.MASAR_DEV_PORT ?? 5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const repoRoot = path.resolve(__dirname, "..");

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
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

  const shutdown = () => {
    localApi.kill();
    vite.kill();
  };
  process.on("SIGINT", () => {
    shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });

  try {
    await waitFor(`${API_URL}/api/health`);
    console.log(`[dev] API ${API_URL}`);
    console.log(`[dev] Open http://localhost:${WEB_PORT}`);
    await waitFor(`http://localhost:${WEB_PORT}`);
  } catch (error) {
    shutdown();
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
