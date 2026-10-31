// electron-builder afterPack hook. Copies the self-contained runtime directory
// (local API, migrator, renderer, migrations and libSQL binaries) into the
// packaged app's Resources folder, untouched.
const { cpSync, existsSync, rmSync } = require("node:fs");
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

  const from = path.join(repoRoot, "desktop", "runtime");
  const to = path.join(resourcesDir, "runtime");

  if (!existsSync(from)) {
    throw new Error(`[after-pack] runtime directory missing: ${from}`);
  }

  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  console.log(`[after-pack] copied runtime into ${to}`);
};
