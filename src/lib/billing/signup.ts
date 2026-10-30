import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";

import { getDb, type AppDatabase } from "@/db";
import {
  accounts,
  billingCustomers,
  pendingSignups,
  subscriptions,
  users,
  type PendingSignupRow,
  type UserRow,
} from "@/db/schema";
import { ApiError } from "@/lib/api";
import { addDemoWorkspace } from "@/lib/server/demo";
import type { BillingConfig } from "./config";
import { evaluateEntitlement } from "./entitlement";
import type {
  BillingGateway,
  CheckoutSessionSnapshot,
  SubscriptionSnapshot,
} from "./gateway";

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  demoContent: boolean;
}

export interface SignupContext {
  gateway: BillingGateway;
  config: BillingConfig;
  appUrl: string;
  database?: AppDatabase;
  now?: Date;
}

export interface CompletedSignup {
  user: UserRow;
  pending: PendingSignupRow;
  subscription: SubscriptionSnapshot;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function appUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export async function findUserByEmail(
  email: string,
  database: AppDatabase = getDb(),
): Promise<UserRow | null> {
  const [row] = await database
    .select()
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1);
  return row ?? null;
}

export async function findPendingSignupByEmail(
  email: string,
  database: AppDatabase = getDb(),
): Promise<PendingSignupRow | null> {
  const [row] = await database
    .select()
    .from(pendingSignups)
    .where(eq(pendingSignups.email, normalizeEmail(email)))
    .limit(1);
  return row ?? null;
}

export async function findPendingSignupById(
  id: string,
  database: AppDatabase = getDb(),
): Promise<PendingSignupRow | null> {
  const [row] = await database
    .select()
    .from(pendingSignups)
    .where(eq(pendingSignups.id, id))
    .limit(1);
  return row ?? null;
}

export async function findPendingSignupByCustomer(
  stripeCustomerId: string,
  database: AppDatabase = getDb(),
): Promise<PendingSignupRow | null> {
  const [row] = await database
    .select()
    .from(pendingSignups)
    .where(eq(pendingSignups.stripeCustomerId, stripeCustomerId))
    .limit(1);
  return row ?? null;
}

function checkoutSuccessUrl(baseUrl: string, route: string): string {
  // Stripe replaces the literal placeholder. Do not URL-encode the braces.
  return `${appUrl(baseUrl)}${route}?session_id={CHECKOUT_SESSION_ID}`;
}

/**
 * Begin a paid signup. Nothing user-visible is created until Stripe confirms
 * an entitled subscription; this row only lets us resume an abandoned or
 * failed checkout without creating duplicate customers.
 */
export async function startSignup(
  input: SignupInput,
  context: SignupContext,
): Promise<{ url: string }> {
  const database = context.database ?? getDb();
  const email = normalizeEmail(input.email);
  const now = context.now ?? new Date();

  if (await findUserByEmail(email, database)) {
    throw new ApiError(
      "An account with this email already exists. Try signing in instead.",
      409,
    );
  }

  let pending = await findPendingSignupByEmail(email, database);
  if (pending?.userId || pending?.status === "provisioned") {
    throw new ApiError(
      "This signup has already been completed. Try signing in instead.",
      409,
    );
  }

  const passwordHash = await hashPassword(input.password);
  if (pending) {
    const [updated] = await database
      .update(pendingSignups)
      .set({
        name: input.name.trim(),
        passwordHash,
        demoContent: input.demoContent,
        updatedAt: now,
      })
      .where(eq(pendingSignups.id, pending.id))
      .returning();
    if (!updated) throw new Error("Could not update the pending signup.");
    pending = updated;
  } else {
    const [created] = await database
      .insert(pendingSignups)
      .values({
        id: randomUUID(),
        name: input.name.trim(),
        email,
        passwordHash,
        demoContent: input.demoContent,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!created) throw new Error("Could not create the pending signup.");
    pending = created;
  }

  if (!pending.stripeCustomerId) {
    const customer = await context.gateway.createCustomer({
      email,
      name: input.name.trim(),
      metadata: { pendingSignupId: pending.id },
    });
    const [updated] = await database
      .update(pendingSignups)
      .set({
        stripeCustomerId: customer.id,
        updatedAt: now,
      })
      .where(eq(pendingSignups.id, pending.id))
      .returning();
    if (!updated) throw new Error("Could not save the Stripe customer.");
    pending = updated;
  }

  if (pending.checkoutSessionId) {
    const existing = await context.gateway.retrieveCheckoutSession(
      pending.checkoutSessionId,
    );
    if (existing?.status === "open" && existing.url) {
      return { url: existing.url };
    }
    if (existing?.status === "complete" && existing.subscriptionId) {
      const existingSubscription = await context.gateway.retrieveSubscription(
        existing.subscriptionId,
      );
      if (existingSubscription && evaluateEntitlement(existingSubscription, now).entitled) {
        return {
          url: `${appUrl(context.appUrl)}/api/signup/complete?session_id=${encodeURIComponent(existing.id)}`,
        };
      }
    }
  }

  const customerId = pending.stripeCustomerId;
  if (!customerId) {
    throw new ApiError("Could not prepare checkout. Please try again.", 500);
  }

  const existingSubscriptions = await context.gateway.listSubscriptions(
    customerId,
  );

  if (
    existingSubscriptions.some(
      (subscription) => evaluateEntitlement(subscription, now).entitled,
    )
  ) {
    throw new ApiError(
      "A subscription is already active for this signup. Try signing in.",
      409,
    );
  }

  // Clear out abandoned incomplete checkouts before starting another one so a
  // retry cannot leave duplicate subscriptions behind.
  for (const subscription of existingSubscriptions) {
    if (subscription.status === "incomplete") {
      await context.gateway.cancelSubscription(subscription.id);
    }
  }

  const session = await context.gateway.createCheckoutSession({
    customerId,
    priceId: context.config.priceId,
    trialDays: context.config.trialDays,
    successUrl: checkoutSuccessUrl(context.appUrl, "/api/signup/complete"),
    cancelUrl: `${appUrl(context.appUrl)}/signup?checkout=cancelled`,
    metadata: { pendingSignupId: pending.id },
  });

  if (!session.url) {
    throw new ApiError(
      "Stripe did not return a checkout page. Please try again.",
      502,
    );
  }

  await database
    .update(pendingSignups)
    .set({ checkoutSessionId: session.id, updatedAt: now })
    .where(eq(pendingSignups.id, pending.id));

  return { url: session.url };
}

async function insertSubscriptionIfMissing(
  database: AppDatabase,
  userId: string,
  snapshot: SubscriptionSnapshot,
  now: Date,
): Promise<void> {
  const [existing] = await database
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, snapshot.id))
    .limit(1);

  const values = {
    userId,
    stripeCustomerId: snapshot.customerId,
    stripeSubscriptionId: snapshot.id,
    stripePriceId: snapshot.priceId,
    status: snapshot.status,
    planName: snapshot.planName,
    currency: snapshot.currency,
    amount: snapshot.amount,
    interval: snapshot.interval,
    currentPeriodEnd: snapshot.currentPeriodEnd,
    trialStart: snapshot.trialStart,
    trialEnd: snapshot.trialEnd,
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
    canceledAt: snapshot.canceledAt,
    stripeCreatedAt: snapshot.createdAt,
    lastSyncedAt: now,
    updatedAt: now,
  };

  if (existing) {
    await database
      .update(subscriptions)
      .set(values)
      .where(eq(subscriptions.id, existing.id));
    return;
  }

  await database
    .insert(subscriptions)
    .values({
      id: randomUUID(),
      ...values,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: subscriptions.stripeSubscriptionId,
      set: values,
    });
}

async function provisionPendingSignup(
  pending: PendingSignupRow,
  subscription: SubscriptionSnapshot,
  database: AppDatabase,
  now: Date,
): Promise<UserRow> {
  if (pending.userId) {
    const [existing] = await database
      .select()
      .from(users)
      .where(eq(users.id, pending.userId))
      .limit(1);
    if (existing) return existing;
  }

  if (!pending.passwordHash) {
    throw new ApiError(
      "This signup can no longer be completed. Please sign in instead.",
      409,
    );
  }

  const existingUser = await findUserByEmail(pending.email, database);
  if (existingUser) {
    throw new ApiError(
      "An account with this email already exists. Try signing in instead.",
      409,
    );
  }

  const userId = randomUUID();
  const passwordHash = pending.passwordHash;

  try {
    await database.transaction(async (tx) => {
      await tx.insert(users).values({
        id: userId,
        name: pending.name,
        email: pending.email,
        emailVerified: false,
        image: null,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(accounts).values({
        id: randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      });

      const [customer] = await tx
        .select({ id: billingCustomers.id })
        .from(billingCustomers)
        .where(eq(billingCustomers.userId, userId))
        .limit(1);
      if (customer) {
        await tx
          .update(billingCustomers)
          .set({
            stripeCustomerId: subscription.customerId,
            updatedAt: now,
          })
          .where(eq(billingCustomers.id, customer.id));
      } else {
        await tx.insert(billingCustomers).values({
          id: randomUUID(),
          userId,
          stripeCustomerId: subscription.customerId,
          createdAt: now,
          updatedAt: now,
        });
      }

      await insertSubscriptionIfMissing(
        tx as unknown as AppDatabase,
        userId,
        subscription,
        now,
      );

      await tx
        .update(pendingSignups)
        .set({
          status: "provisioned",
          userId,
          passwordHash: null,
          updatedAt: now,
        })
        .where(eq(pendingSignups.id, pending.id));
    });
  } catch (error) {
    // Two concurrent finishers (success redirect + webhook) can race. If the
    // other one won, reuse its user rather than creating a duplicate.
    const refreshed = await findPendingSignupById(pending.id, database);
    if (refreshed?.userId) {
      const [existing] = await database
        .select()
        .from(users)
        .where(eq(users.id, refreshed.userId))
        .limit(1);
      if (existing) return existing;
    }
    throw error;
  }

  const [user] = await database
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new ApiError("Could not create the account.", 500);

  if (pending.demoContent) {
    try {
      await addDemoWorkspace(userId, database);
    } catch (error) {
      console.error("[masar] Could not add demo content after signup:", error);
    }
  }

  return user;
}

export async function completeSignupCheckout(
  sessionId: string,
  context: SignupContext,
): Promise<CompletedSignup> {
  const database = context.database ?? getDb();
  const now = context.now ?? new Date();
  const session: CheckoutSessionSnapshot | null =
    await context.gateway.retrieveCheckoutSession(sessionId);

  if (!session) {
    throw new ApiError("Checkout session not found.", 404);
  }
  if (session.status !== "complete" || session.mode !== "subscription") {
    throw new ApiError("Checkout has not been completed.", 409);
  }

  const pendingId =
    session.metadata.pendingSignupId ?? session.clientReferenceId;
  if (!pendingId) {
    throw new ApiError("Checkout is missing its signup reference.", 409);
  }

  const pending = await findPendingSignupById(pendingId, database);
  if (!pending) {
    throw new ApiError("Signup session not found.", 404);
  }
  if (
    pending.stripeCustomerId &&
    session.customerId &&
    pending.stripeCustomerId !== session.customerId
  ) {
    throw new ApiError("Checkout does not belong to this signup.", 403);
  }
  if (!session.subscriptionId) {
    throw new ApiError("Checkout did not create a subscription.", 409);
  }

  const subscription = await context.gateway.retrieveSubscription(
    session.subscriptionId,
  );
  if (!subscription) {
    throw new ApiError("Subscription not found.", 409);
  }
  if (!evaluateEntitlement(subscription, now).entitled) {
    throw new ApiError(
      "Subscription setup is not complete. No account was created.",
      409,
    );
  }

  const user = await provisionPendingSignup(
    pending,
    subscription,
    database,
    now,
  );
  return { user, pending, subscription };
}
