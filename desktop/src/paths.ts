import { app } from "electron";
import path from "node:path";

/**
 * Single source of truth for filesystem locations. Packaged resources live in
 * `process.resourcesPath/runtime`; development reads from the working tree.
 */
function userDataDir(): string {
  return app.getPath("userData");
}

function resolveResource(...segments: string[]): string {
  const base = app.isPackaged
    ? process.resourcesPath
    : path.join(process.cwd(), "desktop");
  return path.join(base, ...segments);
}

/** libSQL `file:` URL for the local SQLite database. */
export function databaseUrl(): string {
  return `file:${path.join(userDataDir(), "masar.db")}`;
}

/** Bundled local API, migrator, migrations and renderer. */
export function runtimeDir(): string {
  return resolveResource("runtime");
}

export function rendererDir(): string {
  return path.join(runtimeDir(), "renderer");
}

export function migrationsDir(): string {
  return path.join(runtimeDir(), "migrations");
}

export function serverEntry(): string {
  return path.join(runtimeDir(), "server.js");
}

export function migrateEntry(): string {
  return path.join(runtimeDir(), "migrate.js");
}

export function logFile(): string {
  return path.join(app.getPath("logs"), "masar.log");
}
