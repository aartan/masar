/**
 * Development launcher: start `next dev` on a fixed loopback port, wait for it
 * to answer, then open the Electron shell pointed at it. NODE_ENV stays
 * `development`, so the auth origin logic is lenient about the loopback port
 * and no production secret is required. The dev DB remains the repo's
 * ./data/app.db (migrated by the existing `predev` hook).
 */
import { spawn } from "node:child_process";
import path from "node:path";

const PORT = Number(process.env.MASAR_DEV_PORT ?? 3000);
const ORIGIN = `http://localhost:${PORT}`;
const repoRoot = path.resolve(__dirname, "..", "..");

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return spawn(command, args, { cwd: repoRoot, env, stdio: "inherit", shell: false });
}

async function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok || res.status === 404) return; // server is up and routing
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`next dev did not start on ${url} within ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  // Compile the Electron main/preload once so desktop/dist/main.js exists.
  const compile = run("npm", ["run", "desktop:compile"], process.env);
  await new Promise<void>((resolve, reject) => {
    compile.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`desktop:compile exited ${code}`)),
    );
  });

  const next = run("npx", ["next", "dev", "-p", String(PORT)], {
    ...process.env,
    NODE_ENV: "development",
  });

  const electronBin = require("electron") as unknown as string;

  try {
    await waitForServer(`${ORIGIN}/api/health`);
    const electron = run(electronBin, ["."], {
      ...process.env,
      NODE_ENV: "development",
      MASAR_DEV_SERVER_URL: ORIGIN,
    });
    electron.on("exit", () => {
      next.kill();
      process.exit(0);
    });
  } catch (error) {
    next.kill();
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
