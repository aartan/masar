import { describe, expect, it } from "vitest";

import type { EntitlementView } from "@/lib/premium-types";
import {
  entitlementEndDate,
  entitlementEndLabel,
  entitlementSummary,
  formatBillingDate,
} from "@/lib/subscription-format";

function entitlement(
  overrides: Partial<EntitlementView> = {},
): EntitlementView {
  return {
    entitled: true,
    reason: "active",
    status: "active",
    currentPeriodEnd: "2026-12-15T00:00:00.000Z",
    trialEnd: "2026-11-15T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

describe("entitlementSummary", () => {
  it("uses the paid period end after a trial converts to active", () => {
    const summary = entitlementSummary(entitlement());

    expect(summary.title).toBe("Renews on December 15, 2026.");
    expect(summary.title).not.toContain("November 15");
    expect(formatBillingDate(entitlementEndDate(entitlement()))).toBe(
      "December 15, 2026",
    );
    expect(entitlementEndLabel(entitlement())).toBe("Renews on");
  });

  it("does not fall back to a stale trial date when the period end is missing", () => {
    const active = entitlement({ currentPeriodEnd: null });

    expect(entitlementSummary(active).title).toBe(
      "Your subscription is active.",
    );
    expect(entitlementEndDate(active)).toBeNull();
  });

  it("uses the trial end while trialing", () => {
    const trialing = entitlement({ reason: "trialing", status: "trialing" });

    expect(entitlementSummary(trialing).title).toBe(
      "Your trial ends on November 15, 2026.",
    );
    expect(entitlementEndLabel(trialing)).toBe("Trial ends");
  });

  it("falls back to the period end when a trial has no trial end", () => {
    const trialing = entitlement({
      reason: "trialing",
      status: "trialing",
      trialEnd: null,
    });

    expect(entitlementSummary(trialing).title).toBe(
      "Your trial ends on December 15, 2026.",
    );
  });

  it("uses the period end for a canceling subscription", () => {
    const canceling = entitlement({
      reason: "canceling",
      cancelAtPeriodEnd: true,
    });

    expect(entitlementSummary(canceling).title).toBe(
      "Cancels on December 15, 2026. Access continues until then.",
    );
    expect(entitlementEndLabel(canceling)).toBe("Access ends");
  });

  it("does not use trial dates for an ended subscription with a period end", () => {
    const expired = entitlement({
      entitled: false,
      reason: "expired",
      status: "active",
      currentPeriodEnd: "2026-11-15T00:00:00.000Z",
      trialEnd: "2026-11-01T00:00:00.000Z",
    });

    expect(entitlementSummary(expired).title).toBe(
      "Your subscription ended on November 15, 2026.",
    );
    expect(entitlementEndLabel(expired)).toBe("Ended on");
  });
});
