import { app, safeStorage } from "electron";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { PremiumUser } from "../../../src/lib/premium-types";

export interface StoredPremiumSession {
  apiUrl: string;
  token: string;
  user: PremiumUser;
}

function sessionFile(): string {
  return path.join(app.getPath("userData"), "premium-session.bin");
}

function encryptionAvailable(): boolean {
  if (safeStorage.isEncryptionAvailable()) return true;
  if (process.env.MASAR_ALLOW_PLAINTEXT_TOKEN === "1") {
    // Linux systems without a configured keyring can opt in explicitly. The
    // file is still owner-only; this is not enabled silently.
    safeStorage.setUsePlainTextEncryption(true);
    return safeStorage.isEncryptionAvailable();
  }
  return false;
}

/**
 * The API bearer token is encrypted with the OS keystore (Keychain, DPAPI,
 * libsecret). It is never sent to the renderer, written to logs or stored in
 * the local SQLite database.
 */
export function loadPremiumSession(): StoredPremiumSession | null {
  const file = sessionFile();
  if (!existsSync(file)) return null;
  try {
    if (!encryptionAvailable()) return null;
    const decrypted = safeStorage.decryptString(readFileSync(file));
    const parsed = JSON.parse(decrypted) as Partial<StoredPremiumSession>;
    if (
      typeof parsed.apiUrl === "string" &&
      typeof parsed.token === "string" &&
      parsed.user &&
      typeof parsed.user.id === "string" &&
      typeof parsed.user.email === "string"
    ) {
      return parsed as StoredPremiumSession;
    }
    return null;
  } catch {
    return null;
  }
}

export function savePremiumSession(session: StoredPremiumSession): void {
  if (!encryptionAvailable()) {
    throw new Error(
      "OS secure storage is unavailable. Install a system keyring (for example GNOME Keyring or KWallet) and try again.",
    );
  }
  writeFileSync(
    sessionFile(),
    safeStorage.encryptString(JSON.stringify(session)),
    { mode: 0o600 },
  );
}

export function clearPremiumSession(): void {
  rmSync(sessionFile(), { force: true });
}
