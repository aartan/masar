import { jsonOk } from "@/lib/api";
import { getBillingConfig } from "@/lib/billing/config";
import { handleBillingError } from "@/lib/billing/http";
import { getBillingGateway } from "@/lib/billing/stripe-gateway";
import {
  getEntitlementForUser,
  syncSubscriptionForUser,
} from "@/lib/billing/subscriptions";
import { requireApiAuthUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/**
 * Reconcile the signed-in account's access with Stripe. Used by the
 * subscription page when returning from Checkout or the Customer Portal.
 */
export async function POST(): Promise<Response> {
  try {
    const user = await requireApiAuthUser();
    getBillingConfig();
    await syncSubscriptionForUser(user.id, getBillingGateway());
    return jsonOk({ entitlement: await getEntitlementForUser(user.id) });
  } catch (error) {
    return handleBillingError(error);
  }
}
