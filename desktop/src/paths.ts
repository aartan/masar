import { app } from "electron";
import path from "node:path";

/**
 * Single source of truth for every filesystem location the desktop app uses.
 * All platform differences live here; shared code never hardcodes `~/Library`
 * or `%APPDATA%`. `app.getPath("userData")` already resolves per-OS:
 *   macOS   ~/Library/Application Support/Masar
 *   Windows %APPDATA%\Masar
 *   Linux   ~/.config/Masar
 */
function userDataDir(): string {
  return app.getPath("userData");
}

/**
 * Resolve a bundled resource. In a packaged app these live under
 * `process.resourcesPath` (electron-builder afterPack); in development they are
 * read from the repo working tree (cwd when run via npm).
 */
function resolveResource(...segments: string[]): string {
  const base = app.isPackaged ? process.resourcesPath : process.cwd();
  return path.join(base, ...segments);
}

/** libSQL `file:` URL for the local database, in the OS user-data dir. */
export function databaseUrl(): string {
  return `file:${path.join(userDataDir(), "masar.db")}`;
}

/** Directory containing the Next.js standalone server. */
export function standaloneDir(): string {
  return app.isPackaged
    ? resolveResource("standalone")
    : path.join(process.cwd(), ".next", "standalone");
}

/** Absolute path to the bundled Drizzle migrations folder. */
export function migrationsDir(): string {
  return resolveResource("drizzle");
}
