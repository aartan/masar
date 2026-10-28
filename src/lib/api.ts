import { z } from "zod";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function jsonOk<T>(data: T, status = 200): Response {
  return Response.json(data, { status });
}

export function handleRouteError(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const path = issue.path.join(".") || "form";
      if (!fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return Response.json(
      {
        error: error.issues[0]?.message ?? "Please check the form.",
        fieldErrors,
      },
      { status: 422 },
    );
  }

  console.error("[masar] Unhandled API error:", error);
  return Response.json(
    { error: "Something went wrong on our side. Please try again." },
    { status: 500 },
  );
}

export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError("Request body must be valid JSON.", 400);
  }
  return schema.parse(raw);
}

export function assertFound<T>(
  value: T | null | undefined,
  message = "Not found",
): T {
  if (value === null || value === undefined) {
    throw new ApiError(message, 404);
  }
  return value;
}
