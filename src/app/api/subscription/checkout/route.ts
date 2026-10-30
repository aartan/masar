import { jsonOk } from "@/lib/api";
import { getBillingConfig, resolveAppUrl } from "@/lib/billing/config";
import { handleBillingError } from "@/lib/billing/http";
import { startExistingUserCheckout } from "@/lib/billing/manage";
import { getBillingGateway } from "@/lib/billing/stripe-gateway";
import { requireApiAuthUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireApiAuthUser();
    const result = await startExistingUserCheckout(user, {
      gateway: getBillingGateway(),
      config: getBillingConfig(),
      appUrl: resolveAppUrl(request.url),
    });
    return jsonOk(result);
  } catch (error) {
    return handleBillingError(error);
  }
}
