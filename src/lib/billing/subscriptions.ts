import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { getDb, type AppDatabase } from "@/db";
import {
  billingCustomers,
  subscriptions,
  type BillingCustomerRow,
  type SubscriptionRow,
} from "@/db/schema";
import {
  evaluateEntitlement,
  type SubscriptionEntitlement,
} from "./entitlement";
import type { BillingGateway, SubscriptionSnapshot } from "./gateway";

export interface BillingUser {
  id: string;
  email: string;
  name: string;
}

export async function getBillingCustomerForUser(
  userId: string,
  database: AppDatabase = getDb(),
): Promise<BillingCustomerRow | null> {
  const [row] = await database
    .select()
    .from(billingCustomers)
    .where(eq(billingCustomers.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function upsertBillingCustomer(
  userId: string,
  stripeCustomerId: string,
  database: AppDatabase = getDb(),
): Promise<BillingCustomerRow> {
  const now = new Date();
  const existing = await getBillingCustomerForUser(userId, database);
  if (existing) {
    if (existing.stripeCustomerId === stripeCustomerId) return existing;
    const [updated] = await database
      .update(billingCustomers)
      .set({ stripeCustomerId, updatedAt: now })
      .where(eq(billingCustomers.id, existing.id))
      .returning();
    if (!updated) throw new Error("Could not update the billing customer.");
    return updated;
  }

  const [created] = await database
    .insert(billingCustomers)
    .values({
      id: randomUUID(),
      userId,
      stripeCustomerId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  const raced = await getBillingCustomerForUser(userId, database);
  if (!raced) throw new Error("Could not create the billing customer.");
  return raced;
}

export async function ensureBillingCustomer(
  user: BillingUser,
  gateway: BillingGateway,
  database: AppDatabase = getDb(),
): Promise<BillingCustomerRow> {
  const existing = await getBillingCustomerForUser(user.id, database);
  if (existing) return existing;

  const customer = await gateway.createCustomer({
    email: user.email,
    name: user.name,
    metadata: { userId: user.id },
  });
  return upsertBillingCustomer(user.id, customer.id, database);
}

export async function findUserIdByCustomerId(
  stripeCustomerId: string,
  database: AppDatabase = getDb(),
): Promise<string | null> {
  const [row] = await database
    .select({ userId: billingCustomers.userId })
    .from(billingCustomers)
    .where(eq(billingCustomers.stripeCustomerId, stripeCustomerId))
    .limit(1);
  return row?.userId ?? null;
}

export async function upsertSubscription(
  userId: string,
  snapshot: SubscriptionSnapshot,
  database: AppDatabase = getDb(),
): Promise<SubscriptionRow> {
  const now = new Date();
  const [existing] = await database
    .select()
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
    const [updated] = await database
      .update(subscriptions)
      .set(values)
      .where(eq(subscriptions.id, existing.id))
      .returning();
    if (!updated) throw new Error("Could not update the subscription.");
    return updated;
  }

  const [created] = await database
    .insert(subscriptions)
    .values({
      id: randomUUID(),
      ...values,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: subscriptions.stripeSubscriptionId,
      set: values,
    })
    .returning();
  if (!created) throw new Error("Could not save the subscription.");
  return created;
}

export async function linkSubscriptionToUser(
  userId: string,
  snapshot: SubscriptionSnapshot,
  database: AppDatabase = getDb(),
): Promise<SubscriptionRow> {
  await upsertBillingCustomer(userId, snapshot.customerId, database);
  return upsertSubscription(userId, snapshot, database);
}

export async function listSubscriptionsForUser(
  userId: string,
  database: AppDatabase = getDb(),
): Promise<SubscriptionRow[]> {
  return database
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));
}

function rowEnd(row: SubscriptionRow): number {
  return (
    row.currentPeriodEnd?.getTime() ?? row.trialEnd?.getTime() ?? 0
  );
}

/**
 * Pick the subscription that should decide access. An entitled subscription
 * wins over a newer incomplete or canceled one, so a failed duplicate checkout
 * can never hide a valid subscription.
 */
export async function getCurrentSubscription(
  userId: string,
  database: AppDatabase = getDb(),
  now: Date = new Date(),
): Promise<SubscriptionRow | null> {
  const rows = await listSubscriptionsForUser(userId, database);
  if (rows.length === 0) return null;

  const entitled = rows
    .filter((row) => evaluateEntitlement(row, now).entitled)
    .sort((a, b) => rowEnd(b) - rowEnd(a));
  if (entitled[0]) return entitled[0];

  return rows.sort((a, b) => {
    const createdDiff =
      (b.stripeCreatedAt?.getTime() ?? 0) -
      (a.stripeCreatedAt?.getTime() ?? 0);
    if (createdDiff !== 0) return createdDiff;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  })[0] ?? null;
}

export async function getEntitlementForUser(
  userId: string,
  database: AppDatabase = getDb(),
  now: Date = new Date(),
): Promise<SubscriptionEntitlement> {
  return evaluateEntitlement(
    await getCurrentSubscription(userId, database, now),
    now,
  );
}

export async function syncSubscriptionForUser(
  userId: string,
  gateway: BillingGateway,
  database: AppDatabase = getDb(),
): Promise<SubscriptionRow | null> {
  const customer = await getBillingCustomerForUser(userId, database);
  if (!customer) return getCurrentSubscription(userId, database);

  const snapshots = await gateway.listSubscriptions(
    customer.stripeCustomerId,
  );

  for (const snapshot of snapshots) {
    await upsertSubscription(userId, snapshot, database);
  }

  if (snapshots.length === 0) {
    // Stripe says this customer has no subscriptions. Revoke access from any
    // stale local rows rather than retaining a stale entitlement.
    const now = new Date();
    const rows = await listSubscriptionsForUser(userId, database);
    for (const row of rows) {
      if (row.status === "canceled") continue;
      await database
        .update(subscriptions)
        .set({
          status: "canceled",
          currentPeriodEnd: now,
          canceledAt: row.canceledAt ?? now,
          lastSyncedAt: now,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, row.id));
    }
  }

  return getCurrentSubscription(userId, database);
}
