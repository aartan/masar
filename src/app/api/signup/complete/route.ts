import { NextResponse } from "next/server";

import { BillingConfigurationError, getBillingConfig, resolveAppUrl } from "@/lib/billing/config";
import { establishSession } from "@/lib/billing/session";
import { completeSignupCheckout } from "@/lib/billing/signup";
import { getBillingGateway } from "@/lib/billing/stripe-gateway";

export const dynamic = "force-dynamic";

/**
 * Stripe Checkout success redirect. The session is verified directly with
 * Stripe before the account is created; an abandoned or declined checkout can
 * never reach provisioning.
 */
export async function GET(request: Request): Promise<Response> {
  const appUrl = resolveAppUrl(request.url);
  const sessionId = new URL(request.url).searchParams.get("session_id");

  if (!sessionId) {
    return NextResponse.redirect(
      new URL("/signup?checkout=failed", appUrl),
      303,
    );
  }

  try {
    const config = getBillingConfig();
    const result = await completeSignupCheckout(sessionId, {
      gateway: getBillingGateway(),
      config,
      appUrl,
    });
    await establishSession(result.user.id);
    return NextResponse.redirect(new URL("/?setup=success", appUrl), 303);
  } catch (error) {
    console.error("[masar] Could not complete Stripe signup:", error);
    const reason =
      error instanceof BillingConfigurationError ? "unavailable" : "failed";
    return NextResponse.redirect(
      new URL(`/signup?checkout=${reason}`, appUrl),
      303,
    );
  }
}
