import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import { getDb, type AppDatabase } from "@/db";
import {
  pendingSignups,
  stripeWebhookEvents,
  subscriptions,
  users,
} from "@/db/schema";
import type { BillingConfig } from "./config";
import type { BillingGateway } from "./gateway";
import {
  findPendingSignupByCustomer,
  findPendingSignupById,
  completeSignupCheckout,
} from "./signup";
import {
  findUserIdByCustomerId,
  linkSubscriptionToUser,
  upsertSubscription,
} from "./subscriptions";

export interface WebhookContext {
  gateway: BillingGateway;
  config: BillingConfig;
  appUrl: string;
  database?: AppDatabase;
  now?: Date;
}

export interface WebhookResult {
  processed: boolean;
}

function objectId(
  value: string | { id: string } | null | undefined,
): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as unknown as { subscription?: string | { id: string } })
    .subscription;
  const parent = (
    invoice as unknown as {
      parent?: {
        subscription_details?: {
          subscription?: string | { id: string } | null;
        } | null;
      } | null;
    }
  ).parent?.subscription_details?.subscription;
  return objectId(parent) ?? objectId(legacy);
}

async function findUserIdForCustomer(
  stripeCustomerId: string | null,
  database: AppDatabase,
): Promise<string | null> {
  if (!stripeCustomerId) return null;
  const billingUserId = await findUserIdByCustomerId(
    stripeCustomerId,
    database,
  );
  if (billingUserId) return billingUserId;

  const pending = await findPendingSignupByCustomer(
    stripeCustomerId,
    database,
  );
  return pending?.userId ?? null;
}

async function markSubscriptionCanceled(
  subscriptionId: string,
  database: AppDatabase,
  now: Date,
): Promise<void> {
  await database
    .update(subscriptions)
    .set({
      status: "canceled",
      currentPeriodEnd: now,
      canceledAt: now,
      lastSyncedAt: now,
      updatedAt: now,
    })
    .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));
}

async function syncSubscriptionEvent(
  subscriptionId: string,
  customerId: string | null,
  context: WebhookContext,
  database: AppDatabase,
  now: Date,
  deleted: boolean,
): Promise<void> {
  const userId = await findUserIdForCustomer(customerId, database);
  if (!userId) {
    // The checkout.session.completed event provisions the account and links
    // the subscription. Nothing to scope this subscription to yet.
    return;
  }

  const snapshot = await context.gateway.retrieveSubscription(subscriptionId);
  if (snapshot) {
    await upsertSubscription(userId, snapshot, database);
  } else if (deleted) {
    await markSubscriptionCanceled(subscriptionId, database, now);
  }
}

async function handleCheckoutCompleted(
  sessionId: string,
  context: WebhookContext,
  database: AppDatabase,
  now: Date,
): Promise<void> {
  const session = await context.gateway.retrieveCheckoutSession(sessionId);
  if (!session || session.status !== "complete") return;

  // New signups: provision the pending account from verified Stripe state.
  if (session.metadata.pendingSignupId) {
    const pending = await findPendingSignupById(
      session.metadata.pendingSignupId,
      database,
    );
    if (pending && !pending.userId) {
      await completeSignupCheckout(sessionId, {
        gateway: context.gateway,
        config: context.config,
        appUrl: context.appUrl,
        database,
        now,
      });
    }
    return;
  }

  // Existing accounts subscribing or renewing.
  const userId = session.metadata.userId;
  if (!userId) return;

  const [user] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return;

  if (!session.subscriptionId) return;
  const snapshot = await context.gateway.retrieveSubscription(
    session.subscriptionId,
  );
  if (snapshot) {
    await linkSubscriptionToUser(userId, snapshot, database);
  }
}

/**
 * Process one verified Stripe event. The event id is claimed first so retries
 * are safe; if processing fails the claim is released for Stripe to retry.
 * Event payloads are never trusted for access decisions: whenever possible the
 * current subscription is fetched from Stripe again before saving.
 */
export async function processStripeEvent(
  event: Stripe.Event,
  context: WebhookContext,
): Promise<WebhookResult> {
  const database = context.database ?? getDb();
  const now = context.now ?? new Date();

  const [claimed] = await database
    .insert(stripeWebhookEvents)
    .values({ id: event.id, type: event.type, createdAt: now })
    .onConflictDoNothing()
    .returning({ id: stripeWebhookEvents.id });

  if (!claimed) return { processed: false };

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCheckoutCompleted(session.id, context, database, now);
      return { processed: true };
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      await database
        .update(pendingSignups)
        .set({ checkoutSessionId: null, updatedAt: now })
        .where(eq(pendingSignups.checkoutSessionId, session.id));
      return { processed: true };
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object as Stripe.Subscription;
      await syncSubscriptionEvent(
        subscription.id,
        objectId(subscription.customer),
        context,
        database,
        now,
        event.type === "customer.subscription.deleted",
      );
      return { processed: true };
    }

    if (
      event.type === "invoice.paid" ||
      event.type === "invoice.payment_failed"
    ) {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = subscriptionIdFromInvoice(invoice);
      if (subscriptionId) {
        await syncSubscriptionEvent(
          subscriptionId,
          objectId(invoice.customer),
          context,
          database,
          now,
          false,
        );
      }
      return { processed: true };
    }

    // Other event types are acknowledged without processing.
    return { processed: true };
  } catch (error) {
    await database
      .delete(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.id, event.id));
    throw error;
  }
}
