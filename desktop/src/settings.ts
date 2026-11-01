import { app } from "electron";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_API_URL, validateApiUrl } from "./api-config";
import { runtimeDir } from "./paths";

interface RuntimeConfig {
  apiUrl?: unknown;
}

/**
 * The Premium Sync API address is operator configuration, not an in-app
 * setting. Resolution order:
 *   1. MASAR_API_URL environment variable (useful for development/testing)
 *   2. runtime/config.json baked by `desktop:prepare`
 *   3. the build default
 */
export function resolveApiUrl(): string {
  const fromEnv = process.env.MASAR_API_URL?.trim();
  if (fromEnv) return validateApiUrl(fromEnv);

  if (app.isPackaged) {
    try {
      const file = path.join(runtimeDir(), "config.json");
      if (existsSync(file)) {
        const config = JSON.parse(readFileSync(file, "utf8")) as RuntimeConfig;
        if (typeof config.apiUrl === "string" && config.apiUrl.trim()) {
          return validateApiUrl(config.apiUrl);
        }
      }
    } catch {
      /* fall back to the build default */
    }
  }

  return validateApiUrl(DEFAULT_API_URL);
}
