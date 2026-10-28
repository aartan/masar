import { app, safeStorage } from "electron";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Load the persisted Better Auth session-signing secret, or generate one on
 * first run. It is encrypted at rest with the OS keystore (Keychain on macOS,
 * DPAPI on Windows) via Electron `safeStorage`, and stable across restarts so
 * sessions survive. Throwing on unavailable storage is intentional — a random
 * per-launch secret would silently invalidate every existing session.
 */
export function getOrCreateAuthSecret(): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS secure storage is unavailable; the auth secret cannot be protected.");
  }
  const file = path.join(app.getPath("userData"), "better-auth-secret.bin");
  if (existsSync(file)) {
    return safeStorage.decryptString(readFileSync(file));
  }
  const secret = randomBytes(32).toString("base64"); // matches `openssl rand -base64 32`
  writeFileSync(file, safeStorage.encryptString(secret), { mode: 0o600 });
  return secret;
}
