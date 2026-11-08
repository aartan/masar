export class ClientApiError extends Error {
  readonly status: number;
  readonly fieldErrors?: Record<string, string>;

  constructor(
    message: string,
    status: number,
    fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "ClientApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

interface ApiErrorBody {
  error?: string;
  fieldErrors?: Record<string, string>;
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...options,
    headers,
    cache: "no-store",
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    throw new ClientApiError(
      body?.error ?? "Something went wrong. Please try again.",
      response.status,
      body?.fieldErrors,
    );
  }

  // Local writes are captured by SQLite triggers. Nudge the background sync
  // engine so it can push them without waiting for the periodic interval.
  if (
    typeof window !== "undefined" &&
    options.method &&
    options.method.toUpperCase() !== "GET" &&
    response.ok
  ) {
    void window.masarDesktop?.notifyDataChanged();
  }

  return payload as T;
}

/** Fetch binary content (for example a whiteboard image) from the local API. */
export async function apiBlob(
  path: string,
  options: RequestInit = {},
): Promise<Blob> {
  const response = await fetch(path, { ...options, cache: "no-store" });
  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const body = payload as ApiErrorBody | null;
    throw new ClientApiError(
      body?.error ?? "Could not load the image.",
      response.status,
      body?.fieldErrors,
    );
  }
  return response.blob();
}

export function errorMessage(error: unknown): string {
  if (error instanceof ClientApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
