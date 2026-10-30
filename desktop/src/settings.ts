import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_SYNC_URL } from "./sync-config";

export type WorkspaceMode = "local" | "sync";

export interface DesktopSettings {
  /** Which backend the app uses. Defaults to the free offline local workspace. */
  mode: WorkspaceMode;
  /**
   * Legacy placeholder from builds before real billing. Ignored; kept only so
   * reading an old settings file does not fail.
   */
  premiumUnlocked?: boolean;
  /** Overrides the hosted sync URL; normally null (the baked default is used). */
  syncUrl: string | null;
}

const DEFAULTS: DesktopSettings = {
  mode: "local",
  syncUrl: null,
};

function settingsFile(): string {
  return path.join(app.getPath("userData"), "masar-desktop.json");
}

export function readSettings(): DesktopSettings {
  try {
    const raw = JSON.parse(readFileSync(settingsFile(), "utf8")) as Partial<DesktopSettings>;
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(patch: Partial<DesktopSettings>): DesktopSettings {
  const next = { ...readSettings(), ...patch };
  writeFileSync(settingsFile(), JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

/** The central hosted app URL for sync mode, or null if none is configured. */
export function resolveSyncUrl(): string | null {
  const stored = readSettings().syncUrl?.trim();
  if (stored) return stored;
  const fromEnv = process.env.MASAR_SYNC_URL?.trim();
  if (fromEnv) return fromEnv;
  return DEFAULT_SYNC_URL.trim() || null;
}

