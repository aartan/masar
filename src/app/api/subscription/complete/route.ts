import { NextResponse } from "next/server";

import { BillingConfigurationError, getBillingConfig, resolveAppUrl } from "@/lib/billing/config";
import { completeExistingUserCheckout } from "@/lib/billing/manage";
import { getBillingGateway } from "@/lib/billing/stripe-gateway";
import { requireAuthUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/** Browser return from a renewal Checkout. */
export async function GET(request: Request): Promise<Response> {
  const appUrl = resolveAppUrl(request.url);
  const sessionId = new URL(request.url).searchParams.get("session_id");

  if (!sessionId) {
    return NextResponse.redirect(
      new URL("/subscription?checkout=failed", appUrl),
      303,
    );
  }

  try {
    const user = await requireAuthUser();
    await completeExistingUserCheckout(sessionId, user.id, {
      gateway: getBillingGateway(),
      config: getBillingConfig(),
      appUrl,
    });
    return NextResponse.redirect(
      new URL("/?setup=success", appUrl),
      303,
    );
  } catch (error) {
    console.error("[masar] Could not complete subscription checkout:", error);
    const reason =
      error instanceof BillingConfigurationError ? "unavailable" : "failed";
    return NextResponse.redirect(
      new URL(`/subscription?checkout=${reason}`, appUrl),
      303,
    );
  }
}
