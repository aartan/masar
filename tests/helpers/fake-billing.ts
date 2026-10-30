import { randomUUID } from "node:crypto";

import type {
  BillingCustomerSnapshot,
  BillingGateway,
  CheckoutSessionSnapshot,
  CreateCheckoutInput,
  CreateCustomerInput,
  CreatePortalInput,
  SubscriptionSnapshot,
} from "@/lib/billing/gateway";

function addDays(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

/**
 * In-memory Stripe stand-in for integration tests. It implements only the
 * gateway contract used by the app; no test uses real network calls.
 */
export class FakeBillingGateway implements BillingGateway {
  readonly customers = new Map<string, CreateCustomerInput>();
  readonly checkouts = new Map<string, CheckoutSessionSnapshot>();
  readonly subscriptions = new Map<string, SubscriptionSnapshot>();
  private counter = 0;

  async createCustomer(
    input: CreateCustomerInput,
  ): Promise<BillingCustomerSnapshot> {
    this.counter += 1;
    const id = `cus_test_${this.counter}`;
    this.customers.set(id, input);
    return { id };
  }

  async createCheckoutSession(
    input: CreateCheckoutInput,
  ): Promise<CheckoutSessionSnapshot> {
    this.counter += 1;
    const id = `cs_test_${this.counter}`;
    const snapshot: CheckoutSessionSnapshot = {
      id,
      status: "open",
      mode: "subscription",
      customerId: input.customerId,
      subscriptionId: null,
      clientReferenceId:
        input.metadata.pendingSignupId ??
        input.metadata.userId ??
        null,
      metadata: input.metadata,
      url: `https://checkout.test/${id}`,
    };
    this.checkouts.set(id, snapshot);
    return snapshot;
  }

  async retrieveCheckoutSession(
    sessionId: string,
  ): Promise<CheckoutSessionSnapshot | null> {
    return this.checkouts.get(sessionId) ?? null;
  }

  async retrieveSubscription(
    subscriptionId: string,
  ): Promise<SubscriptionSnapshot | null> {
    return this.subscriptions.get(subscriptionId) ?? null;
  }

  async listSubscriptions(customerId: string): Promise<SubscriptionSnapshot[]> {
    return [...this.subscriptions.values()].filter(
      (subscription) => subscription.customerId === customerId,
    );
  }

  async listOpenCheckoutSessions(
    customerId: string,
  ): Promise<CheckoutSessionSnapshot[]> {
    return [...this.checkouts.values()].filter(
      (session) =>
        session.customerId === customerId && session.status === "open",
    );
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return;
    this.subscriptions.set(subscriptionId, {
      ...subscription,
      status: "canceled",
      currentPeriodEnd: new Date(),
      canceledAt: new Date(),
    });
  }

  async createPortalSession(
    input: CreatePortalInput,
  ): Promise<{ url: string }> {
    return { url: `https://billing.test/${input.customerId}` };
  }

  /** Test helper: finish Checkout and create an entitled subscription. */
  completeCheckout(
    sessionId: string,
    overrides: Partial<SubscriptionSnapshot> = {},
  ): SubscriptionSnapshot {
    const session = this.checkouts.get(sessionId);
    if (!session?.customerId) {
      throw new Error(`Checkout ${sessionId} has no customer.`);
    }
    this.counter += 1;
    const subscription: SubscriptionSnapshot = {
      id: `sub_test_${this.counter}`,
      customerId: session.customerId,
      status: "trialing",
      priceId: "price_test",
      planName: "Masar Pro",
      currency: "usd",
      amount: 1200,
      interval: "month",
      currentPeriodEnd: addDays(14),
      trialStart: new Date(),
      trialEnd: addDays(14),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      createdAt: new Date(),
      ...overrides,
    };
    this.subscriptions.set(subscription.id, subscription);
    this.checkouts.set(sessionId, {
      ...session,
      status: "complete",
      subscriptionId: subscription.id,
    });
    return subscription;
  }

  /** Test helper: update the fake Stripe-side subscription. */
  updateSubscription(
    subscriptionId: string,
    patch: Partial<SubscriptionSnapshot>,
  ): SubscriptionSnapshot {
    const existing = this.subscriptions.get(subscriptionId);
    if (!existing) throw new Error(`Unknown subscription ${subscriptionId}`);
    const next = { ...existing, ...patch };
    this.subscriptions.set(subscriptionId, next);
    return next;
  }

  /** Test helper: expire an open checkout without creating a subscription. */
  expireCheckout(sessionId: string): void {
    const existing = this.checkouts.get(sessionId);
    if (!existing) return;
    this.checkouts.set(sessionId, { ...existing, status: "expired" });
  }

  /** Test helper: deterministic ids for assertions. */
  uniqueId(prefix = "test"): string {
    return `${prefix}_${randomUUID()}`;
  }
}
