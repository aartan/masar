import type { EntitlementView } from "@/lib/premium-types";

function parseBillingDate(
  value: string | Date | null | undefined,
): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatBillingDate(
  value: string | Date | null | undefined,
): string | null {
  const date = parseBillingDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * The date that describes the next lifecycle event for the current
 * entitlement. Stripe keeps trial timestamps after a trial converts to a paid
 * subscription, so `trialEnd` is only authoritative while trialing.
 */
export function entitlementEndDate(
  entitlement: EntitlementView,
): Date | null {
  const periodEnd = parseBillingDate(entitlement.currentPeriodEnd);
  if (entitlement.reason === "trialing") {
    return parseBillingDate(entitlement.trialEnd) ?? periodEnd;
  }
  if (entitlement.reason === "expired" || entitlement.reason === "canceled") {
    return periodEnd ?? parseBillingDate(entitlement.trialEnd);
  }
  return periodEnd;
}

/** Human-readable label for the date returned by `entitlementEndDate`. */
export function entitlementEndLabel(entitlement: EntitlementView): string {
  switch (entitlement.reason) {
    case "trialing":
      return "Trial ends";
    case "active":
      return "Renews on";
    case "canceling":
      return "Access ends";
    case "payment_issue":
      return entitlement.entitled ? "Access continues until" : "Ended on";
    case "expired":
    case "canceled":
      return "Ended on";
    default:
      return "Current period ends";
  }
}

export function formatBillingAmount(
  amount: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (amount === null || amount === undefined) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${(currency || "usd").toUpperCase()}`;
  }
}

export function billingIntervalLabel(
  interval: string | null | undefined,
): string | null {
  if (!interval) return null;
  return interval === "year" ? "year" : interval === "month" ? "month" : interval;
}

export function statusLabel(entitlement: EntitlementView): string {
  switch (entitlement.reason) {
    case "trialing":
      return "Trial";
    case "active":
      return "Active";
    case "canceling":
      return "Canceling";
    case "payment_issue":
      return entitlement.entitled ? "Payment issue" : "Payment failed";
    case "expired":
      return "Expired";
    case "canceled":
      return "Canceled";
    case "incomplete":
      return "Incomplete";
    case "paused":
      return "Paused";
    default:
      return "No subscription";
  }
}

export function statusTone(
  entitlement: EntitlementView,
): "success" | "default" | "destructive" | "muted" {
  if (entitlement.reason === "payment_issue") return "destructive";
  if (!entitlement.entitled) return "muted";
  if (entitlement.reason === "canceling") return "default";
  return "success";
}

export function entitlementSummary(
  entitlement: EntitlementView,
): { title: string; description: string } {
  const end = formatBillingDate(entitlementEndDate(entitlement));

  switch (entitlement.reason) {
    case "trialing":
      return {
        title: end ? `Your trial ends on ${end}.` : "Your trial is active.",
        description:
          "You have full online access during the trial. Cancel before it ends to avoid a charge.",
      };
    case "active":
      return {
        title: end ? `Renews on ${end}.` : "Your subscription is active.",
        description:
          "You have full online access. Manage billing to update payment details or view invoices.",
      };
    case "canceling":
      return {
        title: end
          ? `Cancels on ${end}. Access continues until then.`
          : "Your subscription is canceling at the end of the period.",
        description:
          "You keep full online access until the cancellation date. Manage billing if you want to keep the subscription.",
      };
    case "payment_issue":
      return {
        title: entitlement.entitled
          ? "Payment failed. Update your payment method."
          : "Payment failed and online access is paused.",
        description: end
          ? `Access continues until ${end} while the payment issue is resolved. Update billing to avoid interruption.`
          : "Update your payment method to restore online access.",
      };
    case "expired":
      return {
        title: end
          ? `Your subscription ended on ${end}.`
          : "Your subscription has ended.",
        description:
          "Your data is safe and will return when you resubscribe. You can still manage billing or sign out.",
      };
    case "canceled":
      return {
        title: end
          ? `Your subscription ended on ${end}.`
          : "Your subscription is canceled.",
        description:
          "Your data is safe and will return when you resubscribe. You can still manage billing or sign out.",
      };
    case "incomplete":
      return {
        title: "Checkout was not completed.",
        description:
          "No account access was granted because the subscription is incomplete. You can start a new checkout safely.",
      };
    case "paused":
      return {
        title: "Your subscription is paused.",
        description:
          "Online access is restricted while the subscription is paused. Manage billing to resume it.",
      };
    default:
      return {
        title: "No online subscription.",
        description:
          "Choose a plan to start using your online workspace. Your local desktop workspace is always free.",
      };
  }
}
