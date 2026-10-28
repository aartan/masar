// electron-builder afterPack hook. Copies the Next.js standalone server (with
// its native libSQL binaries for every arch) and the Drizzle migrations into
// the packaged app's resources, verbatim. This runs once per target arch.
//
// We copy here instead of via `extraResources` because electron-builder's file
// pipeline strips `.node` binaries out of extraResources and otherwise tries to
// manage native modules itself (bundling only the host arch). The standalone
// tree is already self-contained, so we hand it over untouched.
const { cpSync, rmSync, existsSync } = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const repoRoot = path.resolve(__dirname, "..", "..");

  const resourcesDir =
    electronPlatformName === "darwin"
      ? path.join(
          appOutDir,
          `${packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources",
        )
      : path.join(appOutDir, "resources");

  const copies = [
    [path.join(repoRoot, ".next", "standalone"), path.join(resourcesDir, "standalone")],
    [path.join(repoRoot, "drizzle"), path.join(resourcesDir, "drizzle")],
  ];

  for (const [from, to] of copies) {
    if (!existsSync(from)) {
      throw new Error(`[after-pack] required source missing: ${from}`);
    }
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to, { recursive: true });
  }
  console.log(`[after-pack] copied standalone + drizzle into ${resourcesDir}`);
};
