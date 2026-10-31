import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_API_URL, normalizeApiUrl, validateApiUrl } from "./api-config";

export interface DesktopSettings {
  /** Premium Sync API address, or null to use the build default. */
  apiUrl: string | null;
  /** Background sync is on by default once an account is connected. */
  autoSync: boolean;
  /** Legacy fields from older builds are ignored but preserved on write. */
  mode?: string;
  premiumUnlocked?: boolean;
  syncUrl?: string | null;
}

const DEFAULTS: DesktopSettings = {
  apiUrl: null,
  autoSync: true,
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

/** Resolution order: saved setting, environment, build default. */
export function resolveApiUrl(): string {
  const stored = readSettings().apiUrl?.trim();
  if (stored) return normalizeApiUrl(stored);
  const fromEnv = process.env.MASAR_API_URL?.trim();
  if (fromEnv) return normalizeApiUrl(fromEnv);
  return normalizeApiUrl(DEFAULT_API_URL);
}

export function saveApiUrl(value: string): string {
  const validated = validateApiUrl(value);
  writeSettings({ apiUrl: validated });
  return validated;
}
