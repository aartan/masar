import * as React from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { AccountSettingsHeading } from "@/components/account/account-settings-heading";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { isDeleteAccountConfirmed } from "@/lib/account-deletion";
import {
  DELETE_ACCOUNT_PHRASE,
  type PremiumStatus,
} from "@/lib/premium-types";

export function DeleteAccountPage() {
  const bridge = window.masarDesktop;
  const navigate = useNavigate();
  const [premium, setPremium] = React.useState<PremiumStatus | null>(null);
  const [loading, setLoading] = React.useState(Boolean(bridge));
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [confirmation, setConfirmation] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [deleted, setDeleted] = React.useState(false);
  const [cleanupWarning, setCleanupWarning] = React.useState<string | null>(
    null,
  );
  const confirmed = isDeleteAccountConfirmed(confirmation);

  React.useEffect(() => {
    if (!bridge) return;
    let active = true;
    void bridge
      .getPremiumStatus()
      .then((status) => {
        if (active) setPremium(status);
      })
      .catch((caught: unknown) => {
        if (active) {
          setLoadError(
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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bridge || !confirmed || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await bridge.deleteAccount(confirmation);
      setCleanupWarning(result.cleanupWarning);
      setDeleted(true);
      if (result.cleanupWarning) {
        toast.warning("Account deleted with a cleanup warning", {
          description: result.cleanupWarning,
        });
      } else {
        toast.success("Account deleted", {
          description: "Your account and synced data were permanently deleted.",
        });
      }
    } catch (caught) {
      setDeleteError(
        caught instanceof Error
          ? caught.message
          : "The account could not be deleted. Please try again.",
      );
    } finally {
      setDeleting(false);
    }
  }

  if (!bridge) {
    return (
      <DeleteAccountShell description="Permanently delete your Masar account and its synced data.">
        <Card className="mt-6">
          <CardContent className="space-y-4 px-5 py-6 text-[13px] leading-relaxed text-muted-foreground">
            <p>Account deletion is available in the Masar desktop application.</p>
            <BackToAccount />
          </CardContent>
        </Card>
      </DeleteAccountShell>
    );
  }

  if (loading) {
    return (
      <div className="grid h-full place-items-center px-6">
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading account…
        </div>
      </div>
    );
  }

  if (deleted) {
    return (
      <DeleteAccountShell description="Your account deletion has been completed.">
        <Card className="mt-6">
          <CardContent className="flex flex-col items-start gap-4 px-5 py-6">
            <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
              <CheckCircle2 className="size-5" />
            </span>
            <div>
              <CardTitle>Account deleted</CardTitle>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                Your Masar account and all synced data were permanently
                deleted. Your offline local workspace is still available.
              </p>
            </div>
            {cleanupWarning && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2 text-[12px] leading-relaxed text-destructive"
              >
                {cleanupWarning}
              </p>
            )}
            <Button asChild>
              <Link to="/account">
                <ArrowLeft />
                Back to account settings
              </Link>
            </Button>
          </CardContent>
        </Card>
      </DeleteAccountShell>
    );
  }

  if (loadError) {
    return (
      <DeleteAccountShell description="Permanently delete your Masar account and its synced data.">
        <Card className="mt-6">
          <CardContent className="space-y-4 px-5 py-6">
            <p
              role="alert"
              className="rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2 text-[12px] leading-relaxed text-destructive"
            >
              {loadError}
            </p>
            <BackToAccount />
          </CardContent>
        </Card>
      </DeleteAccountShell>
    );
  }

  if (!premium?.connected) {
    return (
      <DeleteAccountShell description="Permanently delete your Masar account and its synced data.">
        <Card className="mt-6">
          <CardContent className="space-y-4 px-5 py-6">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              No premium account is connected. Sign in from Account settings
              before deleting an account.
            </p>
            <BackToAccount />
          </CardContent>
        </Card>
      </DeleteAccountShell>
    );
  }

  return (
    <DeleteAccountShell description="Permanently delete your Masar account and its synced data. Your offline local workspace will remain available.">
      <Card className="mt-6 border-destructive/25">
        <CardHeader>
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-destructive/10 text-destructive">
              <TriangleAlert className="size-4" />
            </span>
            <CardTitle>This action is permanent</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Deleting your account cannot be undone. Review what will be
            removed before continuing.
          </p>
          <Separator />
          <ul className="space-y-2 text-[12.5px] leading-relaxed text-muted-foreground">
            <li>Your Masar account and sign-in access are permanently removed.</li>
            <li>
              Synced cloud data is erased, including boards, columns, tasks,
              labels, subtasks, and comments.
            </li>
            <li>All active sessions and sync access are revoked immediately.</li>
            <li>
              Any active subscription is canceled and billing access ends.
            </li>
            <li>
              The synced copy and stored session on this device are removed.
            </li>
          </ul>
          <div className="rounded-lg border border-border/70 bg-muted/30 px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground/85">
              Your offline local workspace is not affected.
            </p>
            <p className="mt-1">
              The separate local workspace stored on this device remains
              available without an account.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Confirm deletion</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="delete-account-confirmation">
                Type{" "}
                <span className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px] text-foreground">
                  {DELETE_ACCOUNT_PHRASE}
                </span>{" "}
                to confirm
              </Label>
              <Input
                id="delete-account-confirmation"
                value={confirmation}
                onChange={(event) => {
                  setConfirmation(event.target.value);
                  if (deleteError) setDeleteError(null);
                }}
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                disabled={deleting}
                placeholder={DELETE_ACCOUNT_PHRASE}
                aria-describedby={
                  deleteError ? "delete-account-error" : undefined
                }
              />
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                This field is case-sensitive.
              </p>
            </div>

            {deleteError && (
              <p
                id="delete-account-error"
                role="alert"
                className="rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2 text-[12px] leading-relaxed text-destructive"
              >
                {deleteError}
              </p>
            )}

            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate("/account")}
                disabled={deleting}
              >
                <ArrowLeft />
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={!confirmed || deleting}
              >
                {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                {deleting ? "Deleting account…" : "Delete account permanently"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </DeleteAccountShell>
  );
}

function DeleteAccountShell({
  description,
  children,
}: {
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 lg:py-10">
        <AccountSettingsHeading title="Delete account" description={description} />
        {children}
      </div>
    </div>
  );
}

function BackToAccount() {
  return (
    <Button asChild variant="outline">
      <Link to="/account">
        <ArrowLeft />
        Back to account settings
      </Link>
    </Button>
  );
}
