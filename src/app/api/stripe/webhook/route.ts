import type Stripe from "stripe";

import { jsonOk } from "@/lib/api";
import {
  BillingConfigurationError,
  getBillingConfig,
  resolveAppUrl,
} from "@/lib/billing/config";
import { getBillingGateway } from "@/lib/billing/stripe-gateway";
import { processStripeEvent } from "@/lib/billing/webhooks";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  let event: Stripe.Event;
  let config;
  let gateway;
  try {
    config = getBillingConfig();
    gateway = getBillingGateway();
    event = gateway.constructWebhookEvent(
      await request.text(),
      signature,
      config.webhookSecret,
    );
  } catch (error) {
    if (error instanceof BillingConfigurationError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    // Invalid signatures and malformed payloads must be rejected, not retried.
    return Response.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

  try {
    const result = await processStripeEvent(event, {
      gateway,
      config,
      appUrl: resolveAppUrl(request.url),
    });
    return jsonOk({ received: true, processed: result.processed });
  } catch (error) {
    console.error("[masar] Stripe webhook processing failed:", error);
    // Returning 500 tells Stripe to retry. The dedupe claim was released so
    // the retry can be processed.
    return Response.json(
      { error: "Webhook processing failed." },
      { status: 500 },
    );
  }
}
