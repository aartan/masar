import { app } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_API_URL, selectApiUrl } from "./api-config";

export type ThemePreference = "light" | "dark" | "system";
const THEMES = new Set<ThemePreference>(["light", "dark", "system"]);

interface RuntimeConfig {
  apiUrl?: unknown;
}

function preferencesFile(): string {
  return path.join(app.getPath("userData"), "masar-desktop.json");
}

function readRawPreferences(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(preferencesFile(), "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** UI preferences live in Electron's userData, not the SPA origin's storage. */
export function readThemePreference(): ThemePreference {
  const theme = readRawPreferences().theme;
  return typeof theme === "string" && THEMES.has(theme as ThemePreference)
    ? (theme as ThemePreference)
    : "system";
}

export function writeThemePreference(theme: ThemePreference): void {
  if (!THEMES.has(theme)) throw new Error("Invalid theme preference.");
  const next = { ...readRawPreferences(), theme };
  writeFileSync(preferencesFile(), JSON.stringify(next, null, 2), {
    mode: 0o600,
  });
}

/**
 * The Premium Sync API address is fixed at build time. Packaged builds ignore
 * MASAR_API_URL so users cannot redirect premium accounts to another server.
 * Development builds may set it to point at a local API.
 */
export function resolveApiUrl(): string {
  let configuredApiUrl: string | null = null;
  if (app.isPackaged) {
    try {
      // The address is packaged inside the app archive by `desktop:prepare`.
      const file = path.join(
        app.getAppPath(),
        "desktop",
        "dist",
        "api-config.json",
      );
      if (existsSync(file)) {
        const config = JSON.parse(readFileSync(file, "utf8")) as RuntimeConfig;
        if (typeof config.apiUrl === "string" && config.apiUrl.trim()) {
          configuredApiUrl = config.apiUrl;
        }
      }
    } catch {
      /* fall back to the build default */
    }
  }

  return selectApiUrl({
    packaged: app.isPackaged,
    environmentUrl: process.env.MASAR_API_URL,
    configuredUrl: configuredApiUrl,
    defaultUrl: DEFAULT_API_URL,
  });
}
