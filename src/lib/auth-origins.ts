const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function parseOrigin(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin === "null" ? null : url.origin;
  } catch {
    return null;
  }
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function hasSamePort(first: string, second: string): boolean {
  try {
    return new URL(first).port === new URL(second).port;
  } catch {
    return false;
  }
}

function loopbackAliases(origin: string): string[] {
  if (!isLoopbackOrigin(origin)) return [];

  const url = new URL(origin);
  const port = url.port ? `:${url.port}` : "";
  return [
    `${url.protocol}//localhost${port}`,
    `${url.protocol}//127.0.0.1${port}`,
    `${url.protocol}//[::1]${port}`,
  ];
}

function firstHeaderValue(value: string | null): string | null {
  return value?.split(",")[0]?.trim() || null;
}

function getRequestOrigin(request: Request): string | null {
  const origin = parseOrigin(request.headers.get("origin"));
  if (origin) return origin;

  return parseOrigin(request.headers.get("referer"));
}

function getForwardedOrigin(request: Request): string | null {
  const host = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const protocol = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  if (!host || (protocol !== "http" && protocol !== "https")) return null;

  return parseOrigin(`${protocol}://${host}`);
}

/**
 * Builds the Better Auth origin allowlist.
 *
 * The configured public URL is authoritative. Local development also accepts
 * the usual loopback spellings so opening the app through localhost,
 * 127.0.0.1, or ::1 does not fail the CSRF origin check. Behind a proxy, a
 * request is accepted only when its Origin matches the request URL or the
 * forwarded public host, which keeps same-origin auth working without trusting
 * arbitrary third-party origins.
 */
export function getTrustedAuthOrigins({
  request,
  baseURL,
  nodeEnv = process.env.NODE_ENV,
}: {
  request?: Request;
  baseURL?: string;
  nodeEnv?: string;
} = {}): string[] {
  const origins = new Set<string>();
  const configuredOrigin = parseOrigin(baseURL);

  if (configuredOrigin) {
    origins.add(configuredOrigin);
    for (const alias of loopbackAliases(configuredOrigin)) origins.add(alias);
  }

  if (request) {
    const incomingOrigin = getRequestOrigin(request);
    const requestOrigin = parseOrigin(request.url);
    const forwardedOrigin = getForwardedOrigin(request);

    if (
      incomingOrigin &&
      (incomingOrigin === requestOrigin || incomingOrigin === forwardedOrigin)
    ) {
      origins.add(incomingOrigin);
    }

    if (nodeEnv !== "production") {
      if (requestOrigin && isLoopbackOrigin(requestOrigin)) {
        origins.add(requestOrigin);
      }

      if (
        incomingOrigin &&
        requestOrigin &&
        isLoopbackOrigin(incomingOrigin) &&
        isLoopbackOrigin(requestOrigin) &&
        hasSamePort(incomingOrigin, requestOrigin)
      ) {
        origins.add(incomingOrigin);
      }
    }
  }

  return [...origins];
}
