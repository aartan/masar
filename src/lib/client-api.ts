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

  return payload as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ClientApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
