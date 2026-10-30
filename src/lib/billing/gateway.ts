export type CheckoutSessionStatus = "open" | "complete" | "expired";

export interface BillingCustomerSnapshot {
  id: string;
}

export interface SubscriptionSnapshot {
  id: string;
  customerId: string;
  status: string;
  priceId: string | null;
  planName: string | null;
  currency: string | null;
  amount: number | null;
  interval: string | null;
  currentPeriodEnd: Date | null;
  trialStart: Date | null;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  createdAt: Date;
}

export interface CheckoutSessionSnapshot {
  id: string;
  status: CheckoutSessionStatus;
  mode: string;
  customerId: string | null;
  subscriptionId: string | null;
  clientReferenceId: string | null;
  metadata: Record<string, string>;
  url: string | null;
}

export interface CreateCustomerInput {
  email: string;
  name: string;
  metadata: Record<string, string>;
}

export interface CreateCheckoutInput {
  customerId: string;
  priceId: string;
  trialDays: number;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}

export interface CreatePortalInput {
  customerId: string;
  returnUrl: string;
}

export interface BillingGateway {
  createCustomer(input: CreateCustomerInput): Promise<BillingCustomerSnapshot>;
  createCheckoutSession(
    input: CreateCheckoutInput,
  ): Promise<CheckoutSessionSnapshot>;
  retrieveCheckoutSession(
    sessionId: string,
  ): Promise<CheckoutSessionSnapshot | null>;
  retrieveSubscription(
    subscriptionId: string,
  ): Promise<SubscriptionSnapshot | null>;
  listSubscriptions(customerId: string): Promise<SubscriptionSnapshot[]>;
  listOpenCheckoutSessions(
    customerId: string,
  ): Promise<CheckoutSessionSnapshot[]>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  createPortalSession(input: CreatePortalInput): Promise<{ url: string }>;
}
