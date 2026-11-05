import * as React from "react";
import {
  CheckCircle2,
  Cloud,
  ExternalLink,
  Loader2,
  LogOut,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { AccountSettingsHeading } from "@/components/account/account-settings-heading";
import { DeleteAccountLink } from "@/components/account/delete-account-link";
import {
  SubscribeButton,
  SubscribeSection,
} from "@/components/account/subscribe-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  billingIntervalLabel,
  entitlementSummary,
  formatBillingAmount,
  formatBillingDate,
  statusLabel,
  statusTone,
} from "@/lib/subscription-format";
import type { PremiumStatus } from "@/lib/premium-types";

type AuthMode = "login" | "register";

export function AccountPage() {
  const bridge = window.masarDesktop;
  const location = useLocation();
  const navigate = useNavigate();
  const [premium, setPremium] = React.useState<PremiumStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<AuthMode>("login");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  React.useEffect(() => {
    if (!bridge) {
      setLoading(false);
      return;
    }
    let active = true;
    void bridge
      .getPremiumStatus()
      .then((status) => {
        if (active) setPremium(status);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not load your account.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [bridge]);

  React.useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("deleted") !== "1") return;
    setNotice(
      "Your Masar account and all synced data were permanently deleted. Your offline local workspace is still available.",
    );
    toast.success("Account deleted", {
      description: "Your account and synced data were permanently deleted.",
    });
    navigate("/account", { replace: true });
  }, [location.search, navigate]);

  async function perform(label: string, action: () => Promise<PremiumStatus>) {
    if (busy) return;
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const status = await action();
      setPremium(status);
      return status;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The action could not be completed.",
      );
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault();
    if (!bridge) return;
    if (!email.trim() || password.length < 8) {
      setError("Enter a valid email and a password of at least 8 characters.");
      return;
    }
    if (mode === "register" && !name.trim()) {
      setError("Enter your name.");
      return;
    }
    const result = await perform(mode, () =>
      mode === "register"
        ? bridge.register({ name: name.trim(), email: email.trim(), password })
        : bridge.login({ email: email.trim(), password }),
    );
    if (result) {
      setPassword("");
      const entitled = Boolean(result.entitlement?.entitled);
      toast.success(mode === "register" ? "Account created" : "Signed in", {
        description: entitled
          ? "Cloud sync is active."
          : "Choose a subscription to unlock cloud sync.",
      });
      if (entitled) void bridge.syncNow().catch(() => undefined);
    }
  }

  async function importLocalWorkspace() {
    if (!bridge) return;
    setBusy("import");
    setError(null);
    setNotice(null);
    try {
      const result = await bridge.importLocalWorkspace();
      if (result.boards === 0) {
        setNotice(
          "There is no local workspace to import. Boards you create here are synced automatically.",
        );
        return;
      }
      toast.success("Local workspace imported", {
        description: `${result.boards} board(s) and ${result.tasks} task(s) copied to your cloud workspace and queued for sync.`,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not import the local workspace.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function openBilling(action: "checkout" | "portal") {
    if (!bridge) return;
    setBusy(action);
    setError(null);
    try {
      if (action === "checkout") await bridge.startCheckout();
      else await bridge.openPortal();
      setNotice(
        "Complete the secure Stripe step in your browser, then refresh your status here.",
      );
      toast.success("Browser opened");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not open billing.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!bridge) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 lg:py-10">
          <AccountSettingsHeading
            title="Account"
            description="Manage your sign-in details, subscription, and cloud sync preferences. Your local workspace is always available offline."
          />
          <Card className="mt-6">
            <CardContent className="px-5 py-6 text-[13px] leading-relaxed text-muted-foreground">
              Cloud sync is available in the Masar desktop application.
              This browser preview always uses the local SQLite workspace and
              works fully offline.
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (loading || !premium) {
    return (
      <div className="grid h-full place-items-center px-6">
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading account…
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 lg:py-10">
        <AccountSettingsHeading
          title="Account"
          description="Manage your sign-in details, subscription, and cloud sync preferences. Your local workspace is always available offline."
        />

        {error && <Alert tone="error" title={error} />}
        {notice && <Alert tone="info" title={notice} />}

        {premium.connected ? (
          <ConnectedAccount
            premium={premium}
            busy={busy}
            onImportLocal={() => void importLocalWorkspace()}
            onRefresh={() =>
              void perform("refresh", async () => {
                const status = await bridge.refreshBilling();
                toast.success("Account status refreshed");
                if (status.entitlement?.entitled) {
                  void bridge.syncNow().catch(() => undefined);
                }
                return status;
              })
            }
            onCheckout={() => void openBilling("checkout")}
            onPortal={() => void openBilling("portal")}
            onLogout={() =>
              void perform("logout", async () => {
                const status = await bridge.logout();
                toast.success("Signed out");
                return status;
              })
            }
          />
        ) : (
          <div className="mt-6 space-y-5">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Cloud className="size-4" />
                  </span>
                  <CardTitle>Cloud Sync</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-[12.5px] leading-relaxed text-muted-foreground">
                <p>
                  Your local workspace stays free and fully functional offline.
                  Sign in to access your cloud workspace. Changes sync automatically
                  across your devices while your subscription is active. Your local 
                  data is only uploaded when you choose to import it.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>
                    {mode === "login" ? "Sign in" : "Create an account"}
                  </CardTitle>
                  <div className="flex rounded-lg border border-border/80 bg-muted/30 p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setMode("login")}
                      className={
                        mode === "login"
                          ? "rounded-md bg-background px-2.5 py-1 font-medium shadow-sm"
                          : "px-2.5 py-1 text-muted-foreground"
                      }
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("register")}
                      className={
                        mode === "register"
                          ? "rounded-md bg-background px-2.5 py-1 font-medium shadow-sm"
                          : "px-2.5 py-1 text-muted-foreground"
                      }
                    >
                      Register
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={submitAuth} className="space-y-4">
                  {mode === "register" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="account-name">Name</Label>
                      <Input
                        id="account-name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        autoComplete="name"
                        placeholder="Your name"
                        disabled={busy !== null}
                      />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="account-email">Email</Label>
                    <Input
                      id="account-email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      placeholder="you@example.com"
                      disabled={busy !== null}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="account-password">Password</Label>
                    <Input
                      id="account-password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete={
                        mode === "register" ? "new-password" : "current-password"
                      }
                      placeholder="At least 8 characters"
                      disabled={busy !== null}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy !== null}>
                    {busy === "login" || busy === "register" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Cloud className="size-4" />
                    )}
                    {mode === "login" ? "Sign in" : "Create account"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function Alert({ tone, title }: { tone: "error" | "info"; title: string }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "mt-5 flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-[12.5px] leading-relaxed text-destructive"
          : "mt-5 flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-[12.5px] leading-relaxed text-foreground/85"
      }
    >
      {tone === "error" ? (
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      ) : (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
      )}
      {title}
    </div>
  );
}

function ConnectedAccount({
  premium,
  busy,
  onImportLocal,
  onRefresh,
  onCheckout,
  onPortal,
  onLogout,
}: {
  premium: PremiumStatus;
  busy: string | null;
  onImportLocal: () => void;
  onRefresh: () => void;
  onCheckout: () => void;
  onPortal: () => void;
  onLogout: () => void;
}) {
  const entitlement = premium.entitlement;
  const summary = entitlement ? entitlementSummary(entitlement) : null;
  const price = formatBillingAmount(
    premium.subscription?.amount,
    premium.subscription?.currency,
  );
  const interval = billingIntervalLabel(premium.subscription?.interval);
  const periodEnd = formatBillingDate(
    entitlement?.currentPeriodEnd ?? premium.subscription?.currentPeriodEnd,
  );
  const trialEnd = formatBillingDate(
    entitlement?.trialEnd ?? premium.subscription?.trialEnd,
  );
  const showSubscribe = premium.billingConfigured && !entitlement?.entitled;
  const hasEndedSubscription =
    entitlement?.reason === "expired" || entitlement?.reason === "canceled";

  return (
    <>
      <Card className="mt-6">
        <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate">
              {premium.user?.name ?? "Account"}
            </CardTitle>
            <p className="truncate text-[12px] text-muted-foreground">
              {premium.user?.email}
            </p>
          </div>
          {entitlement && (
            <Badge variant={statusTone(entitlement)}>
              {statusLabel(entitlement)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {entitlement && summary && (
          <div>
            <p className="text-[14px] font-medium text-foreground">
              {summary.title}
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              {summary.description}
            </p>
          </div>
        )}

        {premium.subscription && (
          <>
            <Separator />
            <dl className="grid gap-1.5 text-[12.5px] sm:grid-cols-2">
              <Detail
                label="Plan"
                value={premium.subscription.planName ?? "Cloud Sync"}
              />
              <Detail
                label="Price"
                value={
                  price ? `${price}${interval ? ` / ${interval}` : ""}` : null
                }
              />
              <Detail label="Trial ends" value={trialEnd} />
              <Detail label="Current period ends" value={periodEnd} />
            </dl>
          </>
        )}

        <Separator />

        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          You're using your cloud workspace. Changes sync automatically in 
          the background while you're signed in. Your local workspace remains 
          untouched and becomes active again when you sign out.
        </p>

        {premium.error && (
          <p className="rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2 text-[12px] leading-relaxed text-destructive">
            {premium.error}
          </p>
        )}

        {!premium.billingConfigured && (
          <p className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
            Billing is not currently available. Existing access rules still apply.
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button variant="outline" onClick={onImportLocal} disabled={busy !== null}>
            {busy === "import" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Cloud className="size-4" />
            )}
            Import local workspace
          </Button>
          <Button variant="outline" onClick={onRefresh} disabled={busy !== null}>
            {busy === "refresh" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Refresh status
          </Button>
          {showSubscribe && !hasEndedSubscription && (
            <SubscribeButton busy={busy} onCheckout={onCheckout} />
          )}
          {premium.billingConfigured && premium.subscription && (
            <Button variant="outline" onClick={onPortal} disabled={busy !== null}>
              {busy === "portal" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ExternalLink className="size-4" />
              )}
              Manage billing
            </Button>
          )}
          <Button variant="ghost" onClick={onLogout} disabled={busy !== null}>
            {busy === "logout" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LogOut className="size-4" />
            )}
            Sign out
          </Button>
        </div>
      </CardContent>
      </Card>
      {showSubscribe && hasEndedSubscription && (
        <SubscribeSection busy={busy} onCheckout={onCheckout} />
      )}
      <DeleteAccountLink />
    </>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1.5 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}
