/**
 * Assemble the resources that ship inside Electron:
 *   desktop/runtime/
 *     server.js        bundled local API
 *     migrate.js       bundled Drizzle migrator
 *     renderer/        Vite build
 *     migrations/      Drizzle migrations
 *     node_modules/    libSQL native loader + per-target binaries
 *
 * The rest of the server dependencies are bundled by esbuild. Keeping libSQL
 * external is deliberate: it loads a native addon through a computed require.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { DEFAULT_API_URL, validateApiUrl } from "../src/api-config";

const repoRoot = path.resolve(__dirname, "..", "..");
const runtimeDir = path.join(repoRoot, "desktop", "runtime");
const vendorDir = path.join(repoRoot, "desktop", "vendor");

function fail(message: string): never {
  console.error(`[prepare-runtime] ${message}`);
  process.exit(1);
}

function libsqlVersion(): string {
  const pkg = JSON.parse(
    readFileSync(path.join(repoRoot, "node_modules", "libsql", "package.json"), "utf8"),
  ) as { version: string };
  return pkg.version;
}

function defaultTargets(): string[] {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "darwin") return [`darwin-${arch}`];
  if (platform === "win32") return [`win32-${arch}-msvc`];
  if (platform === "linux") {
    return [`linux-${arch}-gnu`, `linux-${arch}-musl`];
  }
  fail(`unsupported build platform: ${platform}`);
}

function targets(): string[] {
  const raw = process.env.MASAR_TARGETS?.trim();
  if (raw) return raw.split(",").map((target) => target.trim()).filter(Boolean);
  return defaultTargets();
}

function resolveNativePackage(target: string, version: string): string {
  const installed = path.join(repoRoot, "node_modules", "@libsql", target);
  if (existsSync(path.join(installed, "index.node"))) return installed;

  const cached = path.join(vendorDir, `libsql-${target}`);
  if (existsSync(path.join(cached, "index.node"))) return cached;

  console.log(`[prepare-runtime] fetching @libsql/${target}@${version} via npm pack`);
  mkdirSync(vendorDir, { recursive: true });
  const tarball = execFileSync(
    "npm",
    ["pack", `@libsql/${target}@${version}`, "--silent"],
    { cwd: vendorDir, encoding: "utf8" },
  ).trim();
  rmSync(cached, { recursive: true, force: true });
  mkdirSync(cached, { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "-C", cached, "--strip-components=1"], {
    cwd: vendorDir,
  });
  rmSync(path.join(vendorDir, tarball), { force: true });

  if (!existsSync(path.join(cached, "index.node"))) {
    fail(`failed to obtain native binary for @libsql/${target}`);
  }
  return cached;
}

function copyPackage(name: string, destination: string): void {
  const source = path.join(repoRoot, "node_modules", name);
  if (!existsSync(source)) fail(`${name} is missing from node_modules`);
  const target = path.join(destination, name);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

function main(): void {
  const renderer = path.join(repoRoot, "dist", "renderer");
  if (!existsSync(path.join(renderer, "index.html"))) {
    fail("dist/renderer/index.html not found. Run `npm run build` first.");
  }

  for (const file of ["server.js", "migrate.js"]) {
    if (!existsSync(path.join(repoRoot, "desktop", "dist", file))) {
      fail(`desktop/dist/${file} not found. Run \`npm run desktop:compile\` first.`);
    }
  }

  rmSync(runtimeDir, { recursive: true, force: true });
  mkdirSync(runtimeDir, { recursive: true });

  cpSync(renderer, path.join(runtimeDir, "renderer"), { recursive: true });
  console.log("[prepare-runtime] copied renderer");

  cpSync(path.join(repoRoot, "drizzle"), path.join(runtimeDir, "migrations"), {
    recursive: true,
  });
  console.log("[prepare-runtime] copied migrations");

  cpSync(
    path.join(repoRoot, "desktop", "dist", "server.js"),
    path.join(runtimeDir, "server.js"),
  );
  cpSync(
    path.join(repoRoot, "desktop", "dist", "migrate.js"),
    path.join(runtimeDir, "migrate.js"),
  );
  console.log("[prepare-runtime] copied server and migrator");

  // Bake the API address into the app archive at build time. Packaged builds
  // ignore MASAR_API_URL at launch, so this is not user-configurable.
  const configuredApiUrl = validateApiUrl(
    process.env.MASAR_API_URL?.trim() || DEFAULT_API_URL,
  );
  writeFileSync(
    path.join(repoRoot, "desktop", "dist", "api-config.json"),
    JSON.stringify({ apiUrl: configuredApiUrl }, null, 2) + "\n",
    { mode: 0o644 },
  );
  console.log(`[prepare-runtime] configured API ${configuredApiUrl}`);

  const nodeModules = path.join(runtimeDir, "node_modules");
  mkdirSync(nodeModules, { recursive: true });
  for (const pkg of ["libsql", "@neon-rs/load", "detect-libc"]) {
    copyPackage(pkg, nodeModules);
    console.log(`[prepare-runtime] vendored ${pkg}`);
  }

  const version = libsqlVersion();
  for (const target of targets()) {
    const source = resolveNativePackage(target, version);
    const destination = path.join(nodeModules, "@libsql", target);
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(destination, { recursive: true });
    cpSync(source, destination, { recursive: true });
    console.log(`[prepare-runtime] bundled native @libsql/${target}`);
  }

  console.log(
    `[prepare-runtime] done (${readdirSync(path.join(nodeModules, "@libsql")).join(", ")})`,
  );
}

main();
