import { jsonOk, parseJsonBody } from "@/lib/api";
import { getBillingConfig, resolveAppUrl } from "@/lib/billing/config";
import { getBillingGateway } from "@/lib/billing/stripe-gateway";
import { startSignup } from "@/lib/billing/signup";
import { handleBillingError } from "@/lib/billing/http";
import { signupStartSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const input = await parseJsonBody(request, signupStartSchema);
    const config = getBillingConfig();
    const result = await startSignup(input, {
      gateway: getBillingGateway(),
      config,
      appUrl: resolveAppUrl(request.url),
    });
    return jsonOk({ url: result.url });
  } catch (error) {
    return handleBillingError(error);
  }
}
