export class BillingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingConfigurationError";
  }
}

export interface BillingConfig {
  secretKey: string;
  webhookSecret: string;
  priceId: string;
  trialDays: number;
}

function parseTrialDays(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 14;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 730) {
    throw new BillingConfigurationError(
      "STRIPE_TRIAL_DAYS must be an integer between 0 and 730.",
    );
  }
  return value;
}

/**
 * Billing is optional at build time and in local desktop mode. Callers that
 * need Stripe require this configuration explicitly so a missing key can never
 * silently turn into free online access.
 */
export function getBillingConfig(
  env: Record<string, string | undefined> = process.env,
): BillingConfig {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  const priceId = env.STRIPE_PRICE_ID?.trim();

  if (!secretKey) {
    throw new BillingConfigurationError(
      "Stripe billing is not configured. Set STRIPE_SECRET_KEY.",
    );
  }
  if (!priceId) {
    throw new BillingConfigurationError(
      "Stripe billing is not configured. Set STRIPE_PRICE_ID to a recurring price.",
    );
  }
  if (!webhookSecret) {
    throw new BillingConfigurationError(
      "Stripe billing is not configured. Set STRIPE_WEBHOOK_SECRET.",
    );
  }

  return {
    secretKey,
    webhookSecret,
    priceId,
    trialDays: parseTrialDays(env.STRIPE_TRIAL_DAYS),
  };
}

export function getOptionalBillingConfig(
  env: Record<string, string | undefined> = process.env,
): BillingConfig | null {
  try {
    return getBillingConfig(env);
  } catch {
    return null;
  }
}

/**
 * Public origin used for Checkout and Customer Portal return URLs. Prefer the
 * configured auth URL so the redirect stays on the canonical host; fall back
 * to the incoming request for local development.
 */
export function resolveAppUrl(
  requestUrl?: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.BETTER_AUTH_URL?.trim();
  const value =
    configured || (requestUrl ? new URL(requestUrl).origin : undefined);
  if (!value) {
    throw new BillingConfigurationError(
      "Set BETTER_AUTH_URL so Stripe can return to this app.",
    );
  }
  return value.replace(/\/+$/, "");
}
