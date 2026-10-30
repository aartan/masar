import { count, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  accounts,
  boards,
  billingCustomers,
  pendingSignups,
  subscriptions,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api";
import type { BillingConfig } from "@/lib/billing/config";
import {
  evaluateEntitlement,
  type EntitlementSource,
} from "@/lib/billing/entitlement";
import {
  completeExistingUserCheckout,
  createPortalForUser,
  startExistingUserCheckout,
} from "@/lib/billing/manage";
import {
  completeSignupCheckout,
  findPendingSignupByEmail,
  startSignup,
} from "@/lib/billing/signup";
import {
  getBillingCustomerForUser,
  getCurrentSubscription,
  getEntitlementForUser,
  upsertSubscription,
} from "@/lib/billing/subscriptions";
import { processStripeEvent } from "@/lib/billing/webhooks";
import { createTestDatabase, createTestUser } from "./helpers/test-db";
import { FakeBillingGateway } from "./helpers/fake-billing";

let test: Awaited<ReturnType<typeof createTestDatabase>>;
let gateway: FakeBillingGateway;

const config: BillingConfig = {
  secretKey: "sk_test_fake",
  webhookSecret: "whsec_test_fake",
  priceId: "price_test",
  trialDays: 14,
};

const APP_URL = "http://localhost:3000";

beforeEach(async () => {
  test = await createTestDatabase();
  gateway = new FakeBillingGateway();
});

afterEach(async () => {
  await test.close();
});

function signupInput(email = "new@example.test") {
  return {
    name: "New User",
    email,
    password: "correct horse battery staple",
    demoContent: false,
  };
}

function context() {
  return {
    gateway,
    config,
    appUrl: APP_URL,
    database: test.db,
  };
}

function event(
  id: string,
  type: string,
  object: unknown,
): Stripe.Event {
  return { id, type, data: { object } } as unknown as Stripe.Event;
}

async function userCount(email = "new@example.test"): Promise<number> {
  const [row] = await test.db
    .select({ value: count() })
    .from(users)
    .where(eq(users.email, email));
  return row?.value ?? 0;
}

describe("entitlement rules", () => {
  const now = new Date("2026-06-01T12:00:00.000Z");
  const future = new Date("2026-06-15T12:00:00.000Z");
  const past = new Date("2026-05-15T12:00:00.000Z");

  function source(overrides: Partial<EntitlementSource>): EntitlementSource {
    return {
      status: "active",
      currentPeriodEnd: future,
      trialEnd: null,
      cancelAtPeriodEnd: false,
      ...overrides,
    };
  }

  it.each([
    ["active", source({ status: "active" }), true, "active"],
    ["trialing", source({ status: "trialing" }), true, "trialing"],
    ["past_due within paid period", source({ status: "past_due" }), true, "payment_issue"],
    ["cancel at period end", source({ cancelAtPeriodEnd: true }), true, "canceling"],
    ["canceled", source({ status: "canceled" }), false, "canceled"],
    ["unpaid", source({ status: "unpaid" }), false, "payment_issue"],
    ["incomplete", source({ status: "incomplete", currentPeriodEnd: null }), false, "incomplete"],
    ["incomplete_expired", source({ status: "incomplete_expired", currentPeriodEnd: null }), false, "incomplete"],
    ["paused", source({ status: "paused" }), false, "paused"],
    ["active but period ended", source({ currentPeriodEnd: past }), false, "expired"],
    ["active with unknown end", source({ currentPeriodEnd: null }), false, "expired"],
    ["unknown status", source({ status: "mystery" }), false, "canceled"],
  ] as const)("%s", (_label, input, entitled, reason) => {
    const result = evaluateEntitlement(input, now);
    expect(result.entitled).toBe(entitled);
    expect(result.reason).toBe(reason);
  });

  it("uses the trial end when a trial has no period end", () => {
    const result = evaluateEntitlement(
      source({ status: "trialing", currentPeriodEnd: null, trialEnd: future }),
      now,
    );
    expect(result.entitled).toBe(true);
    expect(result.reason).toBe("trialing");
  });

  it("denies access when there is no subscription", () => {
    expect(evaluateEntitlement(null, now)).toMatchObject({
      entitled: false,
      reason: "none",
    });
  });

  it("extends access when a renewal moves the period end forward", () => {
    const before = evaluateEntitlement(source({ currentPeriodEnd: future }), now);
    const after = evaluateEntitlement(
      source({ currentPeriodEnd: new Date("2026-07-15T12:00:00.000Z") }),
      new Date("2026-06-16T12:00:00.000Z"),
    );
    expect(before.entitled).toBe(true);
    expect(after.entitled).toBe(true);
  });
});

describe("signup checkout", () => {
  it("creates a pending signup and reuses the customer and open checkout on retry", async () => {
    const first = await startSignup(signupInput(), context());
    const pending = await findPendingSignupByEmail("new@example.test", test.db);

    expect(first.url).toMatch(/^https:\/\/checkout\.test\//);
    expect(pending).not.toBeNull();
    expect(pending?.passwordHash).not.toBeNull();
    expect(pending?.passwordHash).not.toBe("correct horse battery staple");
    expect(pending?.stripeCustomerId).not.toBeNull();
    expect(await userCount()).toBe(0);

    const second = await startSignup(signupInput(), context());
    expect(second.url).toBe(first.url);
    expect(gateway.customers.size).toBe(1);
    expect(gateway.checkouts.size).toBe(1);
  });

  it("provisions exactly one account, credential, customer, and subscription", async () => {
    await startSignup(signupInput(), context());
    const pending = await findPendingSignupByEmail("new@example.test", test.db);
    const sessionId = pending?.checkoutSessionId;
    if (!sessionId) throw new Error("Missing checkout session");

    gateway.completeCheckout(sessionId);
    const result = await completeSignupCheckout(sessionId, context());
    expect(result.user.email).toBe("new@example.test");

    const [account] = await test.db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, result.user.id));
    expect(account?.providerId).toBe("credential");
    expect(account?.password).toBeTruthy();

    const [customer] = await test.db
      .select()
      .from(billingCustomers)
      .where(eq(billingCustomers.userId, result.user.id));
    expect(customer?.stripeCustomerId).toBe(pending?.stripeCustomerId);

    const rows = await test.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, result.user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("trialing");

    const [finished] = await test.db
      .select()
      .from(pendingSignups)
      .where(eq(pendingSignups.id, pending!.id));
    expect(finished?.status).toBe("provisioned");
    expect(finished?.passwordHash).toBeNull();
    expect((await getEntitlementForUser(result.user.id, test.db)).entitled).toBe(
      true,
    );

    const again = await completeSignupCheckout(sessionId, context());
    expect(again.user.id).toBe(result.user.id);
    expect(await userCount()).toBe(1);
    expect(
      (
        await test.db
          .select({ value: count() })
          .from(subscriptions)
          .where(eq(subscriptions.userId, result.user.id))
      )[0]?.value,
    ).toBe(1);
  });

  it("never creates an account for abandoned, declined, or incomplete checkouts", async () => {
    await startSignup(signupInput(), context());
    const pending = await findPendingSignupByEmail("new@example.test", test.db);
    const sessionId = pending?.checkoutSessionId;
    if (!sessionId) throw new Error("Missing checkout session");

    // Abandoned: Stripe still reports the session as open.
    await expect(completeSignupCheckout(sessionId, context())).rejects.toMatchObject({
      status: 409,
    });
    expect(await userCount()).toBe(0);

    // Declined/incomplete: the session completes but no entitled subscription
    // exists, so provisioning is refused.
    gateway.completeCheckout(sessionId, {
      status: "incomplete",
      currentPeriodEnd: null,
      trialEnd: null,
    });
    await expect(completeSignupCheckout(sessionId, context())).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(await userCount()).toBe(0);

    gateway.expireCheckout(sessionId);
    await expect(completeSignupCheckout(sessionId, context())).rejects.toMatchObject({
      status: 409,
    });
    expect(await userCount()).toBe(0);
  });

  it("cancels an incomplete attempt before retrying checkout", async () => {
    await startSignup(signupInput(), context());
    const firstPending = await findPendingSignupByEmail(
      "new@example.test",
      test.db,
    );
    const firstSession = firstPending?.checkoutSessionId;
    if (!firstSession) throw new Error("Missing checkout session");

    const incomplete = gateway.completeCheckout(firstSession, {
      status: "incomplete",
      currentPeriodEnd: null,
      trialEnd: null,
    });

    const retry = await startSignup(signupInput(), context());
    const secondPending = await findPendingSignupByEmail(
      "new@example.test",
      test.db,
    );
    expect(secondPending?.checkoutSessionId).not.toBe(firstSession);
    expect(gateway.subscriptions.get(incomplete.id)?.status).toBe("canceled");

    const secondSession = secondPending?.checkoutSessionId;
    if (!secondSession) throw new Error("Missing retry checkout session");
    gateway.completeCheckout(secondSession);
    const result = await completeSignupCheckout(secondSession, context());
    expect(result.user.email).toBe("new@example.test");
    expect(retry.url).not.toBe(`https://checkout.test/${firstSession}`);

    const local = await test.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, result.user.id));
    expect(local).toHaveLength(1);
  });

  it("adds demo content only after successful provisioning", async () => {
    await startSignup({ ...signupInput(), demoContent: true }, context());
    const pending = await findPendingSignupByEmail("new@example.test", test.db);
    const sessionId = pending?.checkoutSessionId;
    if (!sessionId) throw new Error("Missing checkout session");

    gateway.completeCheckout(sessionId);
    const result = await completeSignupCheckout(sessionId, context());
    const [row] = await test.db
      .select({ value: count() })
      .from(boards)
      .where(eq(boards.ownerId, result.user.id));
    expect(row?.value).toBe(1);
  });
});

describe("subscription selection", () => {
  it("prefers a valid older subscription over a newer incomplete one", async () => {
    const user = await createTestUser(test.db);
    const customerId = "cus_selection";
    const now = new Date();

    await upsertSubscription(
      user.id,
      {
        id: "sub_valid",
        customerId,
        status: "active",
        priceId: "price_test",
        planName: "Masar Pro",
        currency: "usd",
        amount: 1200,
        interval: "month",
        currentPeriodEnd: new Date(now.getTime() + 86_400_000 * 10),
        trialStart: null,
        trialEnd: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        createdAt: new Date(now.getTime() - 86_400_000 * 30),
      },
      test.db,
    );

    await upsertSubscription(
      user.id,
      {
        id: "sub_incomplete",
        customerId,
        status: "incomplete",
        priceId: "price_test",
        planName: "Masar Pro",
        currency: "usd",
        amount: 1200,
        interval: "month",
        currentPeriodEnd: null,
        trialStart: null,
        trialEnd: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        createdAt: now,
      },
      test.db,
    );

    const current = await getCurrentSubscription(user.id, test.db, now);
    expect(current?.stripeSubscriptionId).toBe("sub_valid");
    expect((await getEntitlementForUser(user.id, test.db, now)).entitled).toBe(
      true,
    );
  });
});

describe("Stripe webhook reconciliation", () => {
  it("provisions an abandoned browser signup exactly once, then tracks cancel, renewal, and expiry", async () => {
    await startSignup(signupInput(), context());
    const pending = await findPendingSignupByEmail("new@example.test", test.db);
    const sessionId = pending?.checkoutSessionId;
    if (!sessionId) throw new Error("Missing checkout session");
    const subscription = gateway.completeCheckout(sessionId);

    const checkoutEvent = event("evt_checkout", "checkout.session.completed", {
      id: sessionId,
    });
    const first = await processStripeEvent(checkoutEvent, context());
    expect(first.processed).toBe(true);
    expect(await userCount()).toBe(1);

    const duplicate = await processStripeEvent(checkoutEvent, context());
    expect(duplicate.processed).toBe(false);
    expect(await userCount()).toBe(1);

    const [user] = await test.db
      .select()
      .from(users)
      .where(eq(users.email, "new@example.test"));
    if (!user) throw new Error("Expected provisioned user");
    expect((await getEntitlementForUser(user.id, test.db)).entitled).toBe(true);

    gateway.updateSubscription(subscription.id, {
      status: "canceled",
      currentPeriodEnd: new Date(Date.now() - 1000),
      canceledAt: new Date(),
    });
    await processStripeEvent(
      event("evt_cancel", "customer.subscription.deleted", {
        id: subscription.id,
        customer: subscription.customerId,
      }),
      context(),
    );
    expect((await getEntitlementForUser(user.id, test.db)).entitled).toBe(false);

    gateway.updateSubscription(subscription.id, {
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 86_400_000 * 30),
      cancelAtPeriodEnd: false,
      canceledAt: null,
    });
    await processStripeEvent(
      event("evt_renew", "invoice.paid", {
        id: "in_test",
        customer: subscription.customerId,
        subscription: subscription.id,
      }),
      context(),
    );
    expect((await getEntitlementForUser(user.id, test.db)).entitled).toBe(true);

    gateway.updateSubscription(subscription.id, {
      currentPeriodEnd: new Date(Date.now() - 1000),
    });
    await processStripeEvent(
      event("evt_failed", "invoice.payment_failed", {
        id: "in_test_2",
        customer: subscription.customerId,
        subscription: subscription.id,
      }),
      context(),
    );
    expect((await getEntitlementForUser(user.id, test.db)).entitled).toBe(false);

    // Out-of-order delivery must not revoke access when live Stripe state says
    // the subscription is still valid.
    gateway.updateSubscription(subscription.id, {
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 86_400_000 * 30),
    });
    await processStripeEvent(
      event("evt_stale_delete", "customer.subscription.deleted", {
        id: subscription.id,
        customer: subscription.customerId,
      }),
      context(),
    );
    expect((await getEntitlementForUser(user.id, test.db)).entitled).toBe(true);
  });

  it("releases the dedupe claim when processing fails so Stripe can retry", async () => {
    await startSignup(signupInput(), context());
    const pending = await findPendingSignupByEmail("new@example.test", test.db);
    const sessionId = pending?.checkoutSessionId;
    if (!sessionId) throw new Error("Missing checkout session");
    gateway.completeCheckout(sessionId);

    const brokenGateway = Object.create(gateway) as FakeBillingGateway;
    brokenGateway.retrieveCheckoutSession = async () => {
      throw new Error("Stripe unavailable");
    };

    const checkoutEvent = event("evt_retry", "checkout.session.completed", {
      id: sessionId,
    });
    await expect(
      processStripeEvent(checkoutEvent, {
        ...context(),
        gateway: brokenGateway,
      }),
    ).rejects.toThrow("Stripe unavailable");

    const retry = await processStripeEvent(checkoutEvent, context());
    expect(retry.processed).toBe(true);
    expect(await userCount()).toBe(1);
  });
});

describe("existing account billing", () => {
  function openSessionId(userId?: string): string {
    const session = [...gateway.checkouts.values()].find(
      (candidate) =>
        candidate.status === "open" &&
        (userId === undefined || candidate.metadata.userId === userId),
    );
    if (!session) throw new Error("Expected an open checkout session");
    return session.id;
  }

  it("creates one customer and reuses an open checkout across retries", async () => {
    const user = await createTestUser(test.db);

    const first = await startExistingUserCheckout(user, context());
    expect(first.url).toMatch(/^https:\/\/checkout\.test\//);
    expect(gateway.customers.size).toBe(1);
    expect(gateway.checkouts.size).toBe(1);
    expect((await getBillingCustomerForUser(user.id, test.db))?.stripeCustomerId).toBe(
      [...gateway.customers.keys()][0],
    );

    const second = await startExistingUserCheckout(user, context());
    expect(second.url).toBe(first.url);
    expect(gateway.customers.size).toBe(1);
    expect(gateway.checkouts.size).toBe(1);
  });

  it("refuses a new checkout once the account is entitled", async () => {
    const user = await createTestUser(test.db);
    const { url } = await startExistingUserCheckout(user, context());
    const sessionId = openSessionId();
    const subscription = gateway.completeCheckout(sessionId);

    await completeExistingUserCheckout(sessionId, user.id, context());
    expect((await getEntitlementForUser(user.id, test.db)).entitled).toBe(true);
    expect((await getCurrentSubscription(user.id, test.db))?.stripeSubscriptionId).toBe(
      subscription.id,
    );

    await expect(startExistingUserCheckout(user, context())).rejects.toMatchObject({
      status: 409,
    });
    expect(gateway.checkouts.size).toBe(1);
    expect(url).toContain(sessionId);
  });

  it("cancels incomplete attempts before a retry and links only the new subscription", async () => {
    const user = await createTestUser(test.db);
    const first = await startExistingUserCheckout(user, context());
    const incomplete = gateway.completeCheckout(openSessionId(), {
      status: "incomplete",
      currentPeriodEnd: null,
      trialEnd: null,
    });

    const retry = await startExistingUserCheckout(user, context());
    expect(retry.url).not.toBe(first.url);
    expect(gateway.subscriptions.get(incomplete.id)?.status).toBe("canceled");
    expect(gateway.checkouts.size).toBe(2);
    expect(gateway.customers.size).toBe(1);

    const retrySession = openSessionId();
    const subscription = gateway.completeCheckout(retrySession);
    await completeExistingUserCheckout(retrySession, user.id, context());

    const rows = await test.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.stripeSubscriptionId).toBe(subscription.id);

    // A third attempt after success is rejected instead of creating duplicates.
    await expect(startExistingUserCheckout(user, context())).rejects.toMatchObject({
      status: 409,
    });
    expect(gateway.checkouts.size).toBe(2);
  });

  it("links an existing account's subscription from a verified webhook exactly once", async () => {
    const user = await createTestUser(test.db);
    await startExistingUserCheckout(user, context());
    const sessionId = openSessionId();
    const subscription = gateway.completeCheckout(sessionId);

    const checkoutEvent = event(
      "evt_existing_checkout",
      "checkout.session.completed",
      { id: sessionId },
    );
    expect((await processStripeEvent(checkoutEvent, context())).processed).toBe(
      true,
    );
    expect((await getEntitlementForUser(user.id, test.db)).entitled).toBe(true);
    expect((await getCurrentSubscription(user.id, test.db))?.stripeSubscriptionId).toBe(
      subscription.id,
    );

    expect((await processStripeEvent(checkoutEvent, context())).processed).toBe(
      false,
    );
  });

  it("rejects uncompleted checkouts and checkouts owned by another account", async () => {
    const owner = await createTestUser(test.db);
    const other = await createTestUser(test.db);

    await startExistingUserCheckout(owner, context());
    const openId = openSessionId();
    await expect(
      completeExistingUserCheckout(openId, owner.id, context()),
    ).rejects.toMatchObject({ status: 409 });

    const otherSession = await startExistingUserCheckout(other, context());
    const otherId = openSessionId(other.id);
    gateway.completeCheckout(otherId);

    await expect(
      completeExistingUserCheckout(otherId, owner.id, context()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      completeExistingUserCheckout("cs_missing", owner.id, context()),
    ).rejects.toMatchObject({ status: 404 });
    expect(otherSession.url).toContain(otherId);
    expect((await getEntitlementForUser(owner.id, test.db)).entitled).toBe(false);
  });

  it("creates one billing customer for repeated portal visits", async () => {
    const user = await createTestUser(test.db);

    const first = await createPortalForUser(user, context());
    const second = await createPortalForUser(user, context());

    expect(first.url).toMatch(/^https:\/\/billing\.test\//);
    expect(second.url).toBe(first.url);
    expect(gateway.customers.size).toBe(1);
    expect(await getBillingCustomerForUser(user.id, test.db)).not.toBeNull();
  });
});
