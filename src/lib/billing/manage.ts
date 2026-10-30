import { ApiError } from "@/lib/api";
import { getDb, type AppDatabase } from "@/db";
import { evaluateEntitlement, type SubscriptionEntitlement } from "./entitlement";
import type { BillingGateway } from "./gateway";
import {
  ensureBillingCustomer,
  getBillingCustomerForUser,
  getEntitlementForUser,
  linkSubscriptionToUser,
} from "./subscriptions";
import type { BillingUser } from "./subscriptions";
import type { BillingConfig } from "./config";

export interface ManageContext {
  gateway: BillingGateway;
  config: BillingConfig;
  appUrl: string;
  database?: AppDatabase;
  now?: Date;
}

function withBaseUrl(appUrl: string, path: string): string {
  return `${appUrl.replace(/\/+$/, "")}${path}`;
}

/**
 * Start a fresh Checkout for an existing account renewing after expiry.
 * Existing accounts never receive a second free trial. Incomplete attempts are
 * canceled first so retries cannot stack duplicate subscriptions.
 */
export async function startExistingUserCheckout(
  user: BillingUser,
  context: ManageContext,
): Promise<{ url: string }> {
  const database = context.database ?? getDb();
  const now = context.now ?? new Date();
  const customer = await ensureBillingCustomer(
    user,
    context.gateway,
    database,
  );

  const current = await context.gateway.listSubscriptions(
    customer.stripeCustomerId,
  );
  if (
    current.some(
      (subscription) => evaluateEntitlement(subscription, now).entitled,
    )
  ) {
    throw new ApiError(
      "A subscription is already active for this account.",
      409,
    );
  }

  // Cancel abandoned payment attempts before a new Checkout so retries cannot
  // stack subscriptions that Stripe might still finalize.
  for (const subscription of current) {
    if (subscription.status === "incomplete") {
      await context.gateway.cancelSubscription(subscription.id);
    }
  }

  // Reuse an in-flight Checkout so clicking Subscribe twice (or retrying after
  // an abandoned payment) never stacks duplicate sessions or subscriptions.
  const openSessions = await context.gateway.listOpenCheckoutSessions(
    customer.stripeCustomerId,
  );
  const reusable = openSessions.find(
    (session) =>
      session.mode === "subscription" &&
      session.metadata.userId === user.id &&
      session.url,
  );
  if (reusable?.url) return { url: reusable.url };

  const session = await context.gateway.createCheckoutSession({
    customerId: customer.stripeCustomerId,
    priceId: context.config.priceId,
    trialDays: 0,
    successUrl: withBaseUrl(
      context.appUrl,
      "/api/subscription/complete?session_id={CHECKOUT_SESSION_ID}",
    ),
    cancelUrl: withBaseUrl(context.appUrl, "/subscription?checkout=cancelled"),
    metadata: { userId: user.id },
  });

  if (!session.url) {
    throw new ApiError(
      "Stripe did not return a checkout page. Please try again.",
      502,
    );
  }
  return { url: session.url };
}

/**
 * Verify a completed existing-account Checkout and attach the subscription.
 * The webhook can perform the same linking if the browser never returns.
 */
export async function completeExistingUserCheckout(
  sessionId: string,
  userId: string,
  context: ManageContext,
): Promise<SubscriptionEntitlement> {
  const database = context.database ?? getDb();
  const now = context.now ?? new Date();
  const session = await context.gateway.retrieveCheckoutSession(sessionId);

  if (!session) throw new ApiError("Checkout session not found.", 404);
  if (session.status !== "complete" || session.mode !== "subscription") {
    throw new ApiError("Checkout has not been completed.", 409);
  }

  const checkoutUserId =
    session.metadata.userId ?? session.clientReferenceId ?? null;
  if (checkoutUserId !== userId) {
    throw new ApiError("Checkout does not belong to this account.", 403);
  }

  const customer = await getBillingCustomerForUser(userId, database);
  if (
    customer &&
    session.customerId &&
    customer.stripeCustomerId !== session.customerId
  ) {
    throw new ApiError("Checkout does not belong to this account.", 403);
  }

  if (!session.subscriptionId) {
    throw new ApiError("Checkout did not create a subscription.", 409);
  }

  const subscription = await context.gateway.retrieveSubscription(
    session.subscriptionId,
  );
  if (!subscription) throw new ApiError("Subscription not found.", 409);

  const entitlement = evaluateEntitlement(subscription, now);
  if (!entitlement.entitled) {
    throw new ApiError(
      "Subscription setup is not complete. No access has been granted.",
      409,
    );
  }

  await linkSubscriptionToUser(userId, subscription, database);
  return getEntitlementForUser(userId, database, now);
}

export async function createPortalForUser(
  user: BillingUser,
  context: ManageContext,
): Promise<{ url: string }> {
  const database = context.database ?? getDb();
  const customer = await ensureBillingCustomer(
    user,
    context.gateway,
    database,
  );
  return context.gateway.createPortalSession({
    customerId: customer.stripeCustomerId,
    returnUrl: withBaseUrl(context.appUrl, "/subscription?portal=return"),
  });
}
