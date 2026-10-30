export type EntitlementReason =
  | "none"
  | "trialing"
  | "active"
  | "canceling"
  | "payment_issue"
  | "expired"
  | "canceled"
  | "incomplete"
  | "paused";

export interface EntitlementSource {
  status: string;
  currentPeriodEnd: Date | null;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface SubscriptionEntitlement {
  entitled: boolean;
  reason: EntitlementReason;
  status: string | null;
  currentPeriodEnd: Date | null;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

const ENTITLED_STATUSES = new Set(["active", "trialing", "past_due"]);

function effectiveEnd(source: EntitlementSource): Date | null {
  return source.currentPeriodEnd ?? source.trialEnd;
}

/**
 * Entitlement is intentionally conservative: an unknown or incomplete state
 * never grants online access. `past_due` keeps access only while the already
 * paid billing period is still running.
 */
export function evaluateEntitlement(
  source: EntitlementSource | null,
  now: Date = new Date(),
): SubscriptionEntitlement {
  if (!source) {
    return {
      entitled: false,
      reason: "none",
      status: null,
      currentPeriodEnd: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
    };
  }

  const end = effectiveEnd(source);
  const notExpired = end !== null && end.getTime() > now.getTime();
  const entitled = ENTITLED_STATUSES.has(source.status) && notExpired;

  let reason: EntitlementReason;
  if (source.status === "canceled") reason = "canceled";
  else if (source.status === "paused") reason = "paused";
  else if (
    source.status === "incomplete" ||
    source.status === "incomplete_expired"
  ) {
    reason = "incomplete";
  } else if (!entitled) {
    reason =
      source.status === "past_due" || source.status === "unpaid"
        ? "payment_issue"
        : source.status === "active" || source.status === "trialing"
          ? "expired"
          : "canceled";
  } else if (source.status === "trialing") {
    reason = "trialing";
  } else if (source.status === "past_due") {
    reason = "payment_issue";
  } else if (source.cancelAtPeriodEnd) {
    reason = "canceling";
  } else {
    reason = "active";
  }

  return {
    entitled,
    reason,
    status: source.status,
    currentPeriodEnd: source.currentPeriodEnd,
    trialEnd: source.trialEnd,
    cancelAtPeriodEnd: source.cancelAtPeriodEnd,
  };
}
