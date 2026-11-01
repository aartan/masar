import { app } from "electron";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
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

/**
 * libSQL `file:` URL for the premium sync mirror database of one remote
 * account. Every premium account gets its own mirror file so its cloud
 * workspace can never share tables with the local workspace or another
 * account. Remote user ids are opaque UUIDs from the API, but they are still
 * reduced to a safe filename before touching the filesystem.
 */
export function syncDatabaseUrl(remoteUserId: string): string {
  const safe = /^[a-zA-Z0-9._-]{1,64}$/.test(remoteUserId)
    ? remoteUserId
    : createHash("sha256").update(remoteUserId).digest("hex").slice(0, 32);
  const directory = path.join(userDataDir(), "sync");
  mkdirSync(directory, { recursive: true });
  return `file:${path.join(directory, `${safe}.db`)}`;
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
