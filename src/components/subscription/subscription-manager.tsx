"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CreditCard,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { DesktopOfflineOption } from "@/components/auth/desktop-offline-option";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { api, errorMessage } from "@/lib/client-api";
import {
  billingIntervalLabel,
  entitlementSummary,
  formatBillingAmount,
  formatBillingDate,
  statusLabel,
  statusTone,
  type EntitlementView,
} from "@/lib/subscription-format";

export interface SubscriptionRecordView {
  planName: string | null;
  amount: number | null;
  currency: string | null;
  interval: string | null;
  status: string;
  currentPeriodEnd: string | null;
  trialStart: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
}

interface SubscriptionManagerProps {
  entitlement: EntitlementView;
  subscription: SubscriptionRecordView | null;
  billingConfigured: boolean;
  hasBillingCustomer: boolean;
  required: boolean;
  notice: string | null;
  syncError: string | null;
}

type BusyAction = "checkout" | "portal" | "sync" | null;

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="text-right text-[12.5px] font-medium text-foreground">
        {value}
      </dd>
    </div>
  );
}

export function SubscriptionManager({
  entitlement,
  subscription,
  billingConfigured,
  hasBillingCustomer,
  required,
  notice,
  syncError,
}: SubscriptionManagerProps) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<BusyAction>(null);
  const [error, setError] = React.useState<string | null>(null);

  const summary = entitlementSummary(entitlement);
  const price = formatBillingAmount(
    subscription?.amount,
    subscription?.currency,
  );
  const interval = billingIntervalLabel(subscription?.interval);
  const trialEnd = formatBillingDate(
    entitlement.trialEnd ?? subscription?.trialEnd,
  );
  const periodEnd = formatBillingDate(
    subscription?.currentPeriodEnd ?? entitlement.currentPeriodEnd,
  );
  const canceledAt = formatBillingDate(subscription?.canceledAt);

  const canSubscribe = billingConfigured && !entitlement.entitled;
  const canManage = billingConfigured && hasBillingCustomer;

  async function goTo(
    action: "checkout" | "portal",
    path: string,
  ): Promise<void> {
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      const { url } = await api<{ url: string }>(path, { method: "POST" });
      window.location.assign(url);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(null);
    }
  }

  async function refresh(): Promise<void> {
    if (busy) return;
    setBusy("sync");
    setError(null);
    try {
      const result = await api<{ entitlement: EntitlementView }>(
        "/api/subscription/sync",
        { method: "POST" },
      );
      if (result.entitlement.entitled) {
        router.push("/");
      }
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-[26px] leading-tight font-semibold text-foreground">
          Subscription &amp; billing
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          Manage online access, payment details, and cancellation. Your local
          desktop workspace stays free and untouched.
        </p>
      </div>

      {required && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-[12.5px] leading-relaxed text-foreground/85">
          An active subscription or trial is required to use the online
          workspace. Subscribe below to restore access.
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-border/70 bg-muted/35 px-4 py-3 text-[12.5px] leading-relaxed text-foreground/85">
          {notice}
        </div>
      )}

      {!billingConfigured && (
        <div className="rounded-xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-[12.5px] leading-relaxed text-destructive">
          Stripe billing is not configured on this deployment. Online
          subscriptions cannot be started or managed until the server
          environment is set up. Existing access rules still apply.
        </div>
      )}

      {syncError && (
        <div className="rounded-xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-[12.5px] leading-relaxed text-destructive">
          {syncError}
        </div>
      )}

      <Card>
        <CardHeader className="gap-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Online access</CardTitle>
            <Badge variant={statusTone(entitlement)}>
              {statusLabel(entitlement)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-[14px] font-medium text-foreground">
              {summary.title}
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              {summary.description}
            </p>
          </div>

          {subscription && (
            <>
              <Separator />
              <dl className="divide-y divide-border/60">
                <DetailRow
                  label="Plan"
                  value={subscription.planName ?? "Masar Pro"}
                />
                <DetailRow
                  label="Price"
                  value={
                    price
                      ? `${price}${interval ? ` / ${interval}` : ""}`
                      : null
                  }
                />
                <DetailRow
                  label="Status"
                  value={
                    subscription.status.charAt(0).toUpperCase() +
                    subscription.status.slice(1).replace(/_/g, " ")
                  }
                />
                <DetailRow label="Trial ends" value={trialEnd} />
                <DetailRow
                  label={
                    entitlement.reason === "canceling"
                      ? "Access until"
                      : "Current period ends"
                  }
                  value={periodEnd}
                />
                <DetailRow
                  label="Canceled on"
                  value={subscription.cancelAtPeriodEnd ? null : canceledAt}
                />
                <DetailRow
                  label="Cancels at period end"
                  value={subscription.cancelAtPeriodEnd ? "Yes" : null}
                />
              </dl>
            </>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2 text-[12px] leading-relaxed text-destructive"
            >
              {error}
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {entitlement.entitled && (
              <Button asChild>
                <Link href="/">
                  <ArrowLeft className="size-4" />
                  Back to workspace
                </Link>
              </Button>
            )}

            {canSubscribe && (
              <Button
                onClick={() => void goTo("checkout", "/api/subscription/checkout")}
                disabled={busy !== null}
              >
                {busy === "checkout" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CreditCard className="size-4" />
                )}
                {entitlement.reason === "canceling"
                  ? "Keep subscription"
                  : entitlement.entitled
                    ? "Change plan"
                    : entitlement.reason === "expired" ||
                        entitlement.reason === "canceled"
                      ? "Resubscribe"
                      : "Subscribe"}
              </Button>
            )}

            {canManage && (
              <Button
                variant="outline"
                onClick={() => void goTo("portal", "/api/subscription/portal")}
                disabled={busy !== null}
              >
                {busy === "portal" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ExternalLink className="size-4" />
                )}
                Manage billing
              </Button>
            )}

            {billingConfigured && (
              <Button
                variant="ghost"
                onClick={() => void refresh()}
                disabled={busy !== null}
              >
                {busy === "sync" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Refresh status
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="rounded-xl border border-border/70 bg-card px-4 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
        Payments and invoices are handled securely by Stripe. Masar never stores
        your card details. Canceling keeps access through the end of the current
        billing period.
      </div>

      <DesktopOfflineOption />
    </div>
  );
}
