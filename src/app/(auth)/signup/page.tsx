import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthPanel } from "@/components/auth/auth-panel";
import { DesktopOfflineOption } from "@/components/auth/desktop-offline-option";
import { getOptionalBillingConfig } from "@/lib/billing/config";

export const metadata: Metadata = {
  title: "Create account",
};

function checkoutNotice(value: string | string[] | undefined): string | null {
  switch (value) {
    case "cancelled":
      return "Checkout was cancelled. No account was created, so you can safely try again.";
    case "failed":
      return "We could not finish setting up your account. If you completed payment, try signing in. Otherwise, please retry checkout.";
    case "unavailable":
      return "Online subscription billing is not configured right now. Please try again later.";
    default:
      return null;
  }
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string | string[] }>;
}) {
  const [{ checkout }, billing] = await Promise.all([
    searchParams,
    Promise.resolve(getOptionalBillingConfig()),
  ]);
  const trialDays = billing?.trialDays ?? 0;

  return (
    <AuthPanel
      title="Create your account"
      description={
        billing
          ? trialDays > 0
            ? `Start your ${trialDays}-day free trial. We collect a card now, but you are not charged until the trial ends.`
            : "Subscribe to start using your online workspace."
          : "Online subscription billing is not configured. Account creation is unavailable right now."
      }
    >
      <div className="space-y-4">
        <AuthForm
          mode="signup"
          trialDays={trialDays}
          notice={checkoutNotice(checkout)}
        />
        <DesktopOfflineOption />
      </div>
    </AuthPanel>
  );
}
