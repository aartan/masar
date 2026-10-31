import * as React from "react";
import {
  CheckCircle2,
  Cloud,
  CloudOff,
  CreditCard,
  ExternalLink,
  Loader2,
  RefreshCw,
  Server,
  Signpost,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

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
import { useSyncStatus } from "@/lib/use-sync-status";
import type { PremiumStatus, SyncStatus } from "@/lib/premium-types";

type AuthMode = "login" | "register";

export function SyncPage() {
  const bridge = window.masarDesktop;
  const sync = useSyncStatus();
  const [premium, setPremium] = React.useState<PremiumStatus | null>(null);
  const [apiUrl, setApiUrl] = React.useState("");
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
    void Promise.all([bridge.getState(), bridge.getPremiumStatus()])
      .then(([state, status]) => {
        if (!active) return;
        setApiUrl(state.apiUrl);
        setPremium(status);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Could not load premium sync.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [bridge]);

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
      setError(caught instanceof Error ? caught.message : "The action could not be completed.");
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
      toast.success(
        mode === "register" ? "Account created" : "Signed in",
        { description: "Premium sync is ready." },
      );
      void bridge.syncNow().catch(() => undefined);
    }
  }

  async function saveApiUrl(event: React.FormEvent) {
    event.preventDefault();
    if (!bridge) return;
    const trimmed = apiUrl.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      setError("Enter an API URL starting with http:// or https://.");
      return;
    }
    const result = await perform("api-url", () => bridge.setApiUrl(trimmed));
    if (result) {
      setNotice("API address saved. Sign in to connect this workspace.");
      toast.success("API address updated");
    }
  }

  async function openBilling(action: "checkout" | "portal") {
    if (!bridge) return;
    setBusy(action);
    setError(null);
    try {
      if (action === "checkout") await bridge.startCheckout();
      else await bridge.openPortal();
      setNotice("Complete the secure Stripe step in your browser, then refresh status here.");
      toast.success("Browser opened");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open billing.");
    } finally {
      setBusy(null);
    }
  }

  if (!bridge) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 lg:py-10">
          <PageHeading />
          <Card className="mt-6">
            <CardContent className="px-5 py-6 text-[13px] leading-relaxed text-muted-foreground">
              Premium sync is available in the Masar desktop application. This
              browser preview always uses the local SQLite workspace and works
              fully offline.
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
          Loading premium sync…
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 lg:py-10">
        <PageHeading />

        {error && <Alert tone="error" title={error} />}
        {notice && <Alert tone="info" title={notice} />}

        {premium.connected ? (
          <div className="mt-6 space-y-5">
            <ConnectedAccount
              premium={premium}
              sync={sync}
              busy={busy}
              onRefresh={() =>
                void perform("refresh", async () => {
                  const status = await bridge.refreshBilling();
                  toast.success("Premium status refreshed");
                  void bridge.syncNow().catch(() => undefined);
                  return status;
                })
              }
              onSync={() =>
                void perform("sync", async () => {
                  await bridge.syncNow();
                  toast.success("Sync requested");
                  return premium;
                })
              }
              onCheckout={() => void openBilling("checkout")}
              onPortal={() => void openBilling("portal")}
              onLogout={() =>
                void perform("logout", async () => {
                  const status = await bridge.logout();
                  toast.success("Signed out of premium sync");
                  return status;
                })
              }
            />
            <ServerCard
              apiUrl={apiUrl}
              onChange={setApiUrl}
              onSubmit={saveApiUrl}
              busy={busy === "api-url"}
            />
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Cloud className="size-4" />
                  </span>
                  <CardTitle>Optional premium sync</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-[12.5px] leading-relaxed text-muted-foreground">
                <p>
                  Your local workspace stays free and fully functional offline.
                  Connecting premium sync adds account access across devices,
                  remote backup and subscription-backed online features.
                </p>
                <p>
                  Subscription and account management are handled by the
                  separate Premium Sync API; no billing logic runs in the
                  desktop app.
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
                      <Label htmlFor="sync-name">Name</Label>
                      <Input
                        id="sync-name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        autoComplete="name"
                        placeholder="Your name"
                        disabled={busy !== null}
                      />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="sync-email">Email</Label>
                    <Input
                      id="sync-email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      placeholder="you@example.com"
                      disabled={busy !== null}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sync-password">Password</Label>
                    <Input
                      id="sync-password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete={mode === "register" ? "new-password" : "current-password"}
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

            <ServerCard
              apiUrl={apiUrl}
              onChange={setApiUrl}
              onSubmit={saveApiUrl}
              busy={busy === "api-url"}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function PageHeading() {
  return (
    <div>
      <p className="text-[10.5px] font-semibold tracking-[0.16em] text-muted-foreground/60 uppercase">
        Account
      </p>
      <h1 className="font-display mt-2 text-[28px] leading-tight font-semibold text-foreground sm:text-[32px]">
        Premium sync
      </h1>
      <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground">
        Manage your premium account and cross-device synchronisation. Local
        boards, tasks and comments remain available offline at all times.
      </p>
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
  sync,
  busy,
  onRefresh,
  onSync,
  onCheckout,
  onPortal,
  onLogout,
}: {
  premium: PremiumStatus;
  sync: SyncStatus | null;
  busy: string | null;
  onRefresh: () => void;
  onSync: () => void;
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
  const trialEnd = formatBillingDate(entitlement?.trialEnd ?? premium.subscription?.trialEnd);

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate">{premium.user?.name ?? "Premium account"}</CardTitle>
            <p className="truncate text-[12px] text-muted-foreground">{premium.user?.email}</p>
          </div>
          {entitlement && (
            <Badge variant={statusTone(entitlement)}>{statusLabel(entitlement)}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {entitlement && summary && (
          <div>
            <p className="text-[14px] font-medium text-foreground">{summary.title}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              {summary.description}
            </p>
          </div>
        )}

        {premium.subscription && (
          <>
            <Separator />
            <dl className="grid gap-1.5 text-[12.5px] sm:grid-cols-2">
              <Detail label="Plan" value={premium.subscription.planName ?? "Masar Pro"} />
              <Detail
                label="Price"
                value={price ? `${price}${interval ? ` / ${interval}` : ""}` : null}
              />
              <Detail label="Trial ends" value={trialEnd} />
              <Detail label="Current period ends" value={periodEnd} />
            </dl>
          </>
        )}

        <Separator />

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
            <p className="text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground/70 uppercase">
              Sync status
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[12.5px] font-medium">
              {sync?.phase === "syncing" ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> Syncing now
                </>
              ) : sync?.phase === "error" ? (
                <>
                  <CloudOff className="size-3.5 text-amber-600" /> Needs attention
                </>
              ) : sync?.phase === "subscription_required" ? (
                <>
                  <CloudOff className="size-3.5 text-amber-600" /> Subscription required
                </>
              ) : sync?.phase === "idle" ? (
                <>
                  <Cloud className="size-3.5 text-emerald-600" /> Up to date
                </>
              ) : (
                <>
                  <Cloud className="size-3.5 text-muted-foreground" /> Not syncing
                </>
              )}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {sync?.lastSyncedAt
                ? `Last synced ${new Date(sync.lastSyncedAt).toLocaleString()}`
                : "Not synced yet"}
              {sync && sync.pendingChanges > 0
                ? ` · ${sync.pendingChanges} local change${sync.pendingChanges === 1 ? "" : "s"} waiting`
                : ""}
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
            <p className="text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground/70 uppercase">
              Conflicts
            </p>
            <p className="mt-1 text-[12.5px] font-medium">
              {sync?.lastConflictCount ?? 0} recorded
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {sync?.lastConflictCount
                ? "Newer changes win; older edits are kept in sync diagnostics."
                : "No conflicts on the last sync."}
            </p>
          </div>
        </div>

        {sync?.lastError && (
          <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[12px] leading-relaxed text-amber-800 dark:text-amber-200">
            {sync.lastError}
          </p>
        )}

        {premium.error && (
          <p className="rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2 text-[12px] leading-relaxed text-destructive">
            {premium.error}
          </p>
        )}

        {!premium.billingConfigured && (
          <p className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
            Billing is not configured on the Premium Sync API. Existing access
            rules still apply.
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button variant="outline" onClick={onRefresh} disabled={busy !== null}>
            {busy === "refresh" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Refresh status
          </Button>
          <Button variant="outline" onClick={onSync} disabled={busy !== null}>
            {busy === "sync" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Cloud className="size-4" />
            )}
            Sync now
          </Button>
          {premium.billingConfigured && !entitlement?.entitled && (
            <Button onClick={onCheckout} disabled={busy !== null}>
              {busy === "checkout" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CreditCard className="size-4" />
              )}
              Subscribe
            </Button>
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
            {busy === "logout" ? <Loader2 className="size-4 animate-spin" /> : <Signpost className="size-4" />}
            Sign out
          </Button>
        </div>
      </CardContent>
    </Card>
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

function ServerCard({
  apiUrl,
  onChange,
  onSubmit,
  busy,
}: {
  apiUrl: string;
  onChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  busy: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Server className="size-4 text-muted-foreground" />
          <CardTitle>Sync server</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={apiUrl}
            onChange={(event) => onChange(event.target.value)}
            placeholder="https://sync.example.com"
            aria-label="Premium Sync API URL"
            disabled={busy}
          />
          <Button type="submit" variant="outline" disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Save address
          </Button>
        </form>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Changing the address signs you out. Use HTTPS for any server that is
          not on this computer.
        </p>
      </CardContent>
    </Card>
  );
}
