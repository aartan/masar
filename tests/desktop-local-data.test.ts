import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  removeSyncMirrorFiles,
  syncMirrorFileName,
} from "../desktop/src/premium/local-data";

let directory: string | null = null;

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = null;
});

describe("desktop account storage cleanup", () => {
  it("removes only the deleted account's mirror and SQLite sidecars", () => {
    const dir = mkdtempSync(join(tmpdir(), "masar-local-data-"));
    directory = dir;
    const target = join(dir, syncMirrorFileName("user-a"));
    const other = join(dir, syncMirrorFileName("user-b"));
    for (const file of [
      target,
      `${target}-wal`,
      `${target}-shm`,
      `${target}-journal`,
      other,
    ]) {
      writeFileSync(file, "data");
    }

    const removed = removeSyncMirrorFiles(dir, "user-a");

    expect(removed).toHaveLength(4);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(`${target}-wal`)).toBe(false);
    expect(existsSync(`${target}-shm`)).toBe(false);
    expect(existsSync(`${target}-journal`)).toBe(false);
    expect(existsSync(other)).toBe(true);
  });

  it("is idempotent when the mirror is already gone", () => {
    const dir = mkdtempSync(join(tmpdir(), "masar-local-data-"));
    directory = dir;
    expect(() => removeSyncMirrorFiles(dir, "missing-account")).not.toThrow();
    expect(() => removeSyncMirrorFiles(dir, "missing-account")).not.toThrow();
  });

  it("reduces unsafe remote ids to a stable filename", () => {
    const name = syncMirrorFileName("../../not/a/path");
    expect(name).toMatch(/^[a-f0-9]{32}\.db$/);
    expect(syncMirrorFileName("user-a")).toBe("user-a.db");
  });
});
