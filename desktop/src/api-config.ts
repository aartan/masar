/**
 * Default address of the Premium Sync API for this build. It is only a
 * convenience default: users and operators can override it in Settings or with
 * MASAR_API_URL. Never hardcode credentials here.
 */
export const DEFAULT_API_URL = "http://127.0.0.1:8787";

export function normalizeApiUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/**
 * Tokens must never travel over plain HTTP except on the loopback interface.
 * This allows local development while enforcing TLS for the eventual remote
 * deployment.
 */
export function validateApiUrl(value: string): string {
  const normalized = normalizeApiUrl(value);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("Enter a valid API URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("The API URL must use http:// or https://.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (!loopback && url.protocol !== "https:") {
    throw new Error("Use HTTPS for any API server that is not on this computer.");
  }
  return normalized;
}
