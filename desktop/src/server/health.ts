/**
 * Poll the server's health endpoint until it returns HTTP 200. The route runs
 * a `select 1`, so a 200 also proves the database opened and migrated cleanly.
 */
export async function waitForHealth(
  url: string,
  { timeoutMs = 30_000, intervalMs = 250 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        return;
      }
      lastError = new Error(`health check returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Server did not become healthy within ${timeoutMs}ms` +
      (lastError instanceof Error ? `: ${lastError.message}` : ""),
  );
}
