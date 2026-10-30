import { jsonOk } from "@/lib/api";
import { getOptionalBillingConfig } from "@/lib/billing/config";
import {
  getBillingCustomerForUser,
  getCurrentSubscription,
  getEntitlementForUser,
} from "@/lib/billing/subscriptions";
import { handleBillingError } from "@/lib/billing/http";
import { requireApiAuthUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const user = await requireApiAuthUser();
    const [subscription, entitlement, customer] = await Promise.all([
      getCurrentSubscription(user.id),
      getEntitlementForUser(user.id),
      getBillingCustomerForUser(user.id),
    ]);
    return jsonOk({
      subscription,
      entitlement,
      hasBillingCustomer: customer !== null,
      billingConfigured: getOptionalBillingConfig() !== null,
    });
  } catch (error) {
    return handleBillingError(error);
  }
}
