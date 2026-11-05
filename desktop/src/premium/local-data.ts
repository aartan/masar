import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";

/**
 * Reduce a remote user id to a safe basename. Normal API ids are already safe;
 * the hash fallback keeps unusual ids from becoming path components.
 */
export function syncMirrorFileName(remoteUserId: string): string {
  const safe = /^[a-zA-Z0-9._-]{1,64}$/.test(remoteUserId)
    ? remoteUserId
    : createHash("sha256").update(remoteUserId).digest("hex").slice(0, 32);
  return `${safe}.db`;
}

/**
 * Remove one account's local sync mirror and SQLite sidecar files. The caller
 * must ensure no local API process still has the database open. Missing files
 * are ignored so account deletion is safe to retry.
 */
export function removeSyncMirrorFiles(
  directory: string,
  remoteUserId: string,
): string[] {
  const base = path.join(directory, syncMirrorFileName(remoteUserId));
  const removed: string[] = [];
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const file = `${base}${suffix}`;
    rmSync(file, { force: true });
    removed.push(file);
  }
  return removed;
}
