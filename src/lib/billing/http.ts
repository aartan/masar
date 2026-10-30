import { handleRouteError } from "@/lib/api";
import { BillingConfigurationError } from "./config";

export function handleBillingError(error: unknown): Response {
  if (error instanceof BillingConfigurationError) {
    return Response.json({ error: error.message }, { status: 503 });
  }
  return handleRouteError(error);
}
