/**
 * Fallback address of the Premium Sync API. Operators can override it with
 * MASAR_API_URL at build time. Never hardcode credentials here.
 */
export const DEFAULT_API_URL = "https://masar-api-1hn1.onrender.com";

export interface ApiUrlSelection {
  /** Whether the app is running from a packaged build. */
  packaged: boolean;
  /** MASAR_API_URL. Honoured only during development. */
  environmentUrl?: string | null;
  /** Address baked into the app by desktop:prepare. */
  configuredUrl?: string | null;
  /** Fallback when no other address is available. */
  defaultUrl?: string;
}

/**
 * Choose the Premium Sync API origin. Packaged builds deliberately ignore
 * MASAR_API_URL so users cannot redirect premium accounts to another server.
 * Development builds may use it for local testing.
 */
export function selectApiUrl({
  packaged,
  environmentUrl,
  configuredUrl,
  defaultUrl = DEFAULT_API_URL,
}: ApiUrlSelection): string {
  if (!packaged) {
    const fromEnvironment = environmentUrl?.trim();
    if (fromEnvironment) return validateApiUrl(fromEnvironment);
  }

  const configured = configuredUrl?.trim();
  if (configured) return validateApiUrl(configured);

  return validateApiUrl(defaultUrl);
}

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
