import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SubscriptionManager } from "@/components/subscription/subscription-manager";
import {
  getOptionalBillingConfig,
} from "@/lib/billing/config";
import { getBillingGateway } from "@/lib/billing/stripe-gateway";
import {
  getBillingCustomerForUser,
  getCurrentSubscription,
  getEntitlementForUser,
  syncSubscriptionForUser,
} from "@/lib/billing/subscriptions";
import { requireAuthUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Subscription & billing",
};

function checkoutNotice(value: string | string[] | undefined): string | null {
  switch (value) {
    case "cancelled":
      return "Checkout was cancelled. No changes were made.";
    case "failed":
      return "We could not finish setting up your subscription. If you completed payment, reload this page in a moment. Otherwise, try again.";
    case "unavailable":
      return "Online subscription billing is not configured right now.";
    default:
      return null;
  }
}

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{
    required?: string | string[];
    setup?: string | string[];
    portal?: string | string[];
    checkout?: string | string[];
  }>;
}) {
  const user = await requireAuthUser();
  const query = await searchParams;
  const billing = getOptionalBillingConfig();
  const shouldSync =
    query.required !== undefined ||
    query.setup === "success" ||
    query.portal === "return";

  let syncError: string | null = null;
  if (billing && shouldSync) {
    try {
      await syncSubscriptionForUser(user.id, getBillingGateway());
    } catch (error) {
      console.error("[masar] Subscription reconciliation failed:", error);
      syncError =
        "We could not reach Stripe to refresh your status. The access shown below is from the last verified update.";
    }
  }

  const [subscription, entitlement, customer] = await Promise.all([
    getCurrentSubscription(user.id),
    getEntitlementForUser(user.id),
    getBillingCustomerForUser(user.id),
  ]);

  // Returning from renewal Checkout or arriving with a stale "required" flag:
  // if Stripe confirms access, send the user straight back to the workspace.
  if (entitlement.entitled && query.required !== undefined) {
    redirect("/");
  }

  return (
    <SubscriptionManager
      entitlement={{
        entitled: entitlement.entitled,
        reason: entitlement.reason,
        status: entitlement.status,
        currentPeriodEnd: entitlement.currentPeriodEnd?.toISOString() ?? null,
        trialEnd: entitlement.trialEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
      }}
      subscription={
        subscription
          ? {
              planName: subscription.planName,
              amount: subscription.amount,
              currency: subscription.currency,
              interval: subscription.interval,
              status: subscription.status,
              currentPeriodEnd:
                subscription.currentPeriodEnd?.toISOString() ?? null,
              trialStart: subscription.trialStart?.toISOString() ?? null,
              trialEnd: subscription.trialEnd?.toISOString() ?? null,
              cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
              canceledAt: subscription.canceledAt?.toISOString() ?? null,
            }
          : null
      }
      billingConfigured={billing !== null}
      hasBillingCustomer={customer !== null}
      required={query.required !== undefined}
      notice={checkoutNotice(query.checkout)}
      syncError={syncError}
    />
  );
}
