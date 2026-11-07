import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copy Excalidraw's self-hosted font assets into public/ so the whiteboard
 * loads them locally (window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/")
 * instead of Excalidraw's default CDN. This keeps whiteboards working offline
 * in the packaged Electron app. The copy is gitignored and regenerated on
 * dev/build/desktop:prepare, so the 13 MB of fonts never enters version control.
 */
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(
  root,
  "node_modules",
  "@excalidraw",
  "excalidraw",
  "dist",
  "prod",
  "fonts",
);
const target = path.join(root, "public", "excalidraw-assets", "fonts");

if (!existsSync(source)) {
  console.error(
    "[excalidraw-assets] source fonts not found; is @excalidraw/excalidraw installed?",
  );
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(path.dirname(target), { recursive: true });
cpSync(source, target, { recursive: true });
console.log("[excalidraw-assets] copied fonts to public/excalidraw-assets/fonts");
