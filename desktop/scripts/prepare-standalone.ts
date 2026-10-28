/**
 * Post-`next build` step that makes `.next/standalone` self-sufficient for the
 * desktop bundle. Next's standalone output omits two things we need:
 *
 *   1. Static assets (`.next/static`, and `public/` if present) — standalone
 *      assumes a CDN serves them, so we copy them in.
 *   2. The native libSQL addon, which is loaded via a computed
 *      `require(`@libsql/${target}`)` the tracer cannot follow. We copy the
 *      native package(s) for every target arch of this release.
 *
 * It also drops the compiled, cwd-independent migrator in as
 * `desktop-migrate.js`.
 *
 * Targets come from MASAR_TARGETS (comma-separated, e.g.
 * "darwin-arm64,darwin-x64,win32-x64-msvc"); the default is both macOS arches.
 * Native packages for the host arch are copied from node_modules; others are
 * fetched once via `npm pack` into desktop/vendor (a gitignored cache).
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..");
const standaloneDir = path.join(repoRoot, ".next", "standalone");
const vendorDir = path.join(repoRoot, "desktop", "vendor");

function fail(message: string): never {
  console.error(`[prepare-standalone] ${message}`);
  process.exit(1);
}

function libsqlVersion(): string {
  const pkg = JSON.parse(
    readFileSync(path.join(repoRoot, "node_modules", "libsql", "package.json"), "utf8"),
  );
  return pkg.version as string;
}

function targets(): string[] {
  const raw = process.env.MASAR_TARGETS?.trim();
  if (raw) return raw.split(",").map((t) => t.trim()).filter(Boolean);
  return ["darwin-arm64", "darwin-x64"];
}

/** Ensure a `@libsql/<target>` package dir exists locally, returning its path. */
function resolveNativePackage(target: string, version: string): string {
  const installed = path.join(repoRoot, "node_modules", "@libsql", target);
  if (existsSync(path.join(installed, "index.node"))) return installed;

  const cached = path.join(vendorDir, `libsql-${target}`);
  if (existsSync(path.join(cached, "index.node"))) return cached;

  // Fetch the tarball without disturbing the project node_modules.
  console.log(`[prepare-standalone] fetching @libsql/${target}@${version} via npm pack`);
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

function main(): void {
  if (!existsSync(path.join(standaloneDir, "server.js"))) {
    fail("`.next/standalone/server.js` not found. Run `next build` first.");
  }

  // 1. Static assets.
  const staticSrc = path.join(repoRoot, ".next", "static");
  const staticDest = path.join(standaloneDir, ".next", "static");
  rmSync(staticDest, { recursive: true, force: true });
  cpSync(staticSrc, staticDest, { recursive: true });
  console.log("[prepare-standalone] copied .next/static");

  const publicSrc = path.join(repoRoot, "public");
  if (existsSync(publicSrc)) {
    cpSync(publicSrc, path.join(standaloneDir, "public"), { recursive: true });
    console.log("[prepare-standalone] copied public/");
  }

  // 2. Native libSQL per target arch.
  const version = libsqlVersion();
  const libsqlDest = path.join(standaloneDir, "node_modules", "@libsql");
  mkdirSync(libsqlDest, { recursive: true });
  for (const target of targets()) {
    const src = resolveNativePackage(target, version);
    const dest = path.join(libsqlDest, target);
    rmSync(dest, { recursive: true, force: true });
    cpSync(src, dest, { recursive: true });
    console.log(`[prepare-standalone] bundled native @libsql/${target}`);
  }

  // The desktop migrator (desktop-migrate.js) does plain `require()` calls for
  // `@libsql/client` and `drizzle-orm/libsql`. Next bundles drizzle-orm into
  // the server's own chunks rather than leaving it in node_modules, and the
  // tracer only copies partial files, so these are not reliably resolvable as
  // standalone packages. Copy the full packages from the repo so the migrator
  // resolves them exactly as the repo does.
  const RUNTIME_PACKAGES = [
    "drizzle-orm",
    "@libsql/client",
    "@libsql/core",
    "@libsql/hrana-client",
    "@libsql/isomorphic-ws",
    "libsql",
  ];
  const nmDest = path.join(standaloneDir, "node_modules");
  for (const pkg of RUNTIME_PACKAGES) {
    const from = path.join(repoRoot, "node_modules", pkg);
    if (!existsSync(from)) fail(`${pkg} missing from repo node_modules (run npm install)`);
    const dest = path.join(nmDest, pkg);
    rmSync(dest, { recursive: true, force: true });
    cpSync(from, dest, { recursive: true });
    console.log(`[prepare-standalone] vendored package ${pkg}`);
  }

  // 3. Compiled helper entries (migrator + local-workspace exporter).
  for (const entry of ["desktop-migrate.js", "desktop-export.js"]) {
    const src = path.join(repoRoot, "desktop", "dist", entry);
    if (!existsSync(src)) {
      fail(`desktop/dist/${entry} not found. Run the desktop compile step first.`);
    }
    cpSync(src, path.join(standaloneDir, entry));
    console.log(`[prepare-standalone] copied ${entry}`);
  }

  console.log(`[prepare-standalone] done (${readdirSync(libsqlDest).join(", ")})`);
}

main();
