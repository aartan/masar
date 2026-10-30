import Stripe from "stripe";

import { getBillingConfig } from "./config";
import type {
  BillingGateway,
  BillingCustomerSnapshot,
  CheckoutSessionSnapshot,
  CreateCheckoutInput,
  CreateCustomerInput,
  CreatePortalInput,
  SubscriptionSnapshot,
} from "./gateway";

function unixToDate(value: number | null | undefined): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Date(value * 1000);
}

function objectId(
  value: string | { id: string } | null | undefined,
): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription): Date | null {
  const itemEnds = subscription.items?.data
    .map((item) => item.current_period_end)
    .filter((value): value is number => Number.isFinite(value));

  // Newer Stripe API versions expose period boundaries on subscription items.
  // Keep a fallback for accounts/API versions that still return it at the top
  // level.
  const legacyEnd = (
    subscription as unknown as { current_period_end?: number | null }
  ).current_period_end;

  const candidates = [
    ...(itemEnds ?? []),
    ...(typeof legacyEnd === "number" ? [legacyEnd] : []),
  ];
  if (candidates.length === 0) return null;
  return unixToDate(Math.max(...candidates));
}

export function subscriptionSnapshotFromStripe(
  subscription: Stripe.Subscription,
): SubscriptionSnapshot {
  const item = subscription.items?.data[0];
  const price = item?.price;
  const productName =
    price && typeof price.product === "object" && "name" in price.product
      ? price.product.name
      : null;

  return {
    id: subscription.id,
    customerId:
      objectId(subscription.customer) ??
      // A deleted customer object can still be represented as an id.
      "",
    status: subscription.status,
    priceId: price?.id ?? null,
    planName: price?.nickname ?? productName,
    currency: price?.currency ?? subscription.currency ?? null,
    amount: price?.unit_amount ?? null,
    interval: price?.recurring?.interval ?? null,
    currentPeriodEnd: subscriptionPeriodEnd(subscription),
    trialStart: unixToDate(subscription.trial_start),
    trialEnd: unixToDate(subscription.trial_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: unixToDate(subscription.canceled_at),
    createdAt: unixToDate(subscription.created) ?? new Date(),
  };
}

function checkoutSnapshotFromStripe(
  session: Stripe.Checkout.Session,
): CheckoutSessionSnapshot {
  const status: CheckoutSessionSnapshot["status"] =
    session.status === "complete"
      ? "complete"
      : session.status === "expired"
        ? "expired"
        : "open";

  return {
    id: session.id,
    status,
    mode: session.mode ?? "payment",
    customerId: objectId(session.customer),
    subscriptionId: objectId(session.subscription),
    clientReferenceId: session.client_reference_id ?? null,
    metadata: Object.fromEntries(
      Object.entries(session.metadata ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    url: session.url,
  };
}

export class StripeBillingGateway implements BillingGateway {
  private readonly stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey, {
      maxNetworkRetries: 2,
      appInfo: { name: "Masar", version: "1.0.0" },
    });
  }

  async createCustomer(
    input: CreateCustomerInput,
  ): Promise<BillingCustomerSnapshot> {
    const customer = await this.stripe.customers.create(
      {
        email: input.email,
        name: input.name,
        metadata: input.metadata,
      },
      { idempotencyKey: `masar-customer-${input.metadata.pendingSignupId ?? input.metadata.userId ?? input.email}` },
    );
    return { id: customer.id };
  }

  async createCheckoutSession(
    input: CreateCheckoutInput,
  ): Promise<CheckoutSessionSnapshot> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      customer: input.customerId,
      client_reference_id:
        input.metadata.pendingSignupId ?? input.metadata.userId ?? undefined,
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: input.metadata,
      subscription_data: {
        metadata: input.metadata,
        ...(input.trialDays > 0
          ? { trial_period_days: input.trialDays }
          : {}),
      },
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      payment_method_collection: "always",
    });
    return checkoutSnapshotFromStripe(session);
  }

  async retrieveCheckoutSession(
    sessionId: string,
  ): Promise<CheckoutSessionSnapshot | null> {
    try {
      const session = await this.stripe.checkout.sessions.retrieve(sessionId);
      return checkoutSnapshotFromStripe(session);
    } catch (error) {
      if (isStripeNotFound(error)) return null;
      throw error;
    }
  }

  async retrieveSubscription(
    subscriptionId: string,
  ): Promise<SubscriptionSnapshot | null> {
    try {
      const subscription =
        await this.stripe.subscriptions.retrieve(subscriptionId);
      return subscriptionSnapshotFromStripe(subscription);
    } catch (error) {
      if (isStripeNotFound(error)) return null;
      throw error;
    }
  }

  async listSubscriptions(customerId: string): Promise<SubscriptionSnapshot[]> {
    const subscriptions = await this.stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
    });
    return subscriptions.data.map(subscriptionSnapshotFromStripe);
  }

  async listOpenCheckoutSessions(
    customerId: string,
  ): Promise<CheckoutSessionSnapshot[]> {
    const sessions = await this.stripe.checkout.sessions.list({
      customer: customerId,
      status: "open",
      limit: 10,
    });
    return sessions.data.map(checkoutSnapshotFromStripe);
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    try {
      await this.stripe.subscriptions.cancel(subscriptionId);
    } catch (error) {
      if (isStripeNotFound(error)) return;
      throw error;
    }
  }

  async createPortalSession(
    input: CreatePortalInput,
  ): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
    });
    return { url: session.url };
  }

  constructWebhookEvent(
    payload: string,
    signature: string,
    webhookSecret: string,
  ): Stripe.Event {
    return this.stripe.webhooks.constructEvent(
      payload,
      signature,
      webhookSecret,
    );
  }
}

function isStripeNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    (error as { statusCode?: number }).statusCode === 404
  );
}

let gateway: StripeBillingGateway | null = null;

export function getBillingGateway(): StripeBillingGateway {
  if (!gateway) {
    gateway = new StripeBillingGateway(getBillingConfig().secretKey);
  }
  return gateway;
}
